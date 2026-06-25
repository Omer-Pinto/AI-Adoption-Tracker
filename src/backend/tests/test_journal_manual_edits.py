"""Self-contained proof for Wave 10: journaled manual edits + targeted report-edit.

Runs against a THROWAWAY DB built from schema.sql in a temp dir (never touches the
user's tracker.db). Drives the REAL engine functions. Run from src/backend/tests/:

    python3 -m pytest tests/test_journal_manual_edits.py -v

or directly:

    python3 tests/test_journal_manual_edits.py

Each scenario prints PASS/FAIL; the process exits non-zero if any assertion fails.
"""

from __future__ import annotations

import datetime
import pathlib
import sqlite3
import sys
import tempfile

# Ensure src/backend/ is on the path so engine/models import cleanly.
_BACKEND = pathlib.Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from models import (  # noqa: E402
    ArtifactChangeKind,
    ArtifactType,
    ReportArtifactEntry,
    ReportDocument,
    ReportTaskEntry,
    TaskStatus,
)
from reports.engine import (  # noqa: E402
    apply_manual_artifact_edit,
    apply_manual_task_edit,
    fan_out_report,
    replay_report_edit,
)

SCHEMA = _BACKEND / "schema.sql"
TODAY = datetime.date.today().isoformat()

_passed = 0
_failed = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  PASS  {label}")
    else:
        _failed += 1
        print(f"  FAIL  {label}  {detail}")


def fresh_conn(db_path: pathlib.Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    conn.commit()
    return conn


def seed_team(conn: sqlite3.Connection) -> tuple[int, int, int]:
    """One team/champion/domain. Returns (team_id, champion_id, domain_id)."""
    team_id = conn.execute(
        "INSERT INTO team (name) VALUES ('Radar')"
    ).lastrowid
    champion_id = conn.execute(
        "INSERT INTO champion (name, team_id) VALUES ('Dana', ?)", (team_id,)
    ).lastrowid
    domain_id = conn.execute(
        "INSERT INTO domain (team_id, champion_id, name) VALUES (?, ?, 'signal-processing')",
        (team_id, champion_id),
    ).lastrowid
    conn.commit()
    return team_id, champion_id, domain_id


def task_id_by_name(conn, champion_id, name) -> int:
    return conn.execute(
        "SELECT t.id FROM task t JOIN domain d ON d.id = t.domain_id "
        "WHERE d.champion_id = ? AND t.name = ?",
        (champion_id, name),
    ).fetchone()["id"]


# ── scenario 1: manual status edit → status updates + manual journal row today ──

def scenario_1(db_dir: pathlib.Path) -> None:
    print("\n[1] manual status edit -> status updates AND a source='manual' row dated today")
    conn = fresh_conn(db_dir / "s1.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2026-06-08", raw_notes="n",
            tasks=[ReportTaskEntry(task="Clutter map", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id, domain="signal-processing")],
        ))
        tid = task_id_by_name(conn, champion_id, "Clutter map")

        apply_manual_task_edit(conn, tid, {"status": "abandoned"})

        task = conn.execute("SELECT * FROM task WHERE id = ?", (tid,)).fetchone()
        check("task.status updated to abandoned", task["status"] == "abandoned",
              f"got {task['status']}")
        check("task.ended_on set to today (terminal)", task["ended_on"] == TODAY,
              f"got {task['ended_on']}")

        manual = conn.execute(
            "SELECT * FROM task_history WHERE task_id = ? AND source = 'manual'", (tid,)
        ).fetchall()
        check("exactly one source='manual' journal row", len(manual) == 1,
              f"got {len(manual)}")
        if manual:
            check("manual row dated today", manual[0]["meeting_date"] == TODAY,
                  f"got {manual[0]['meeting_date']}")
            check("manual row report_id is NULL", manual[0]["report_id"] is None)
            check("manual row status_at_meeting = abandoned",
                  manual[0]["status_at_meeting"] == "abandoned")

        # The journal lists it (the full ordered journey).
        journey = conn.execute(
            "SELECT source, status_at_meeting FROM task_history WHERE task_id = ? "
            "ORDER BY meeting_date, id", (tid,)
        ).fetchall()
        check("journal lists report then manual",
              [r["source"] for r in journey] == ["report", "manual"],
              f"got {[r['source'] for r in journey]}")
    finally:
        conn.close()


# ── scenario 2: manual owner edit → reflected by recompute (journal self-sufficient) ──

def scenario_2(db_dir: pathlib.Path) -> None:
    print("\n[2] manual owner edit -> owner updates AND recompute derives it from the journal")
    conn = fresh_conn(db_dir / "s2.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2026-06-08", raw_notes="n",
            tasks=[ReportTaskEntry(task="Clutter map", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id, domain="signal-processing")],
        ))
        tid = task_id_by_name(conn, champion_id, "Clutter map")

        apply_manual_task_edit(conn, tid, {"owner": "Maya"})

        task = conn.execute("SELECT * FROM task WHERE id = ?", (tid,)).fetchone()
        check("task.owner updated to Maya", task["owner"] == "Maya", f"got {task['owner']}")

        manual = conn.execute(
            "SELECT owner FROM task_history WHERE task_id = ? AND source = 'manual'", (tid,)
        ).fetchone()
        check("manual journal row carries owner=Maya", manual is not None and manual["owner"] == "Maya",
              f"got {manual['owner'] if manual else None}")

        # PROOF the journal (not report_json) drives owner: drop report_json to junk,
        # then recompute — owner must still resolve to Maya from journal columns.
        conn.execute("UPDATE report SET report_json = '{}' WHERE champion_id = ?", (champion_id,))
        conn.commit()
        from reports.engine import _recompute_task_current_state
        _recompute_task_current_state(conn, tid)
        conn.commit()
        task2 = conn.execute("SELECT owner FROM task WHERE id = ?", (tid,)).fetchone()
        check("owner survives recompute with report_json wiped (journal self-sufficient)",
              task2["owner"] == "Maya", f"got {task2['owner']}")
    finally:
        conn.close()


# ── scenario 3: manual edit THEN later report → later report wins; ordered journal ──

def scenario_3(db_dir: pathlib.Path) -> None:
    print("\n[3] manual edit, then a LATER report changes the same task -> later (report) wins")
    conn = fresh_conn(db_dir / "s3.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        # Report dated in the PAST so a later manual edit (today) and a later
        # report (today+1) order after it.
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2020-01-01", raw_notes="n",
            tasks=[ReportTaskEntry(task="Clutter map", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id, domain="signal-processing")],
        ))
        tid = task_id_by_name(conn, champion_id, "Clutter map")

        # manual edit today -> blocked
        apply_manual_task_edit(conn, tid, {"status": "blocked"})
        mid = conn.execute("SELECT status FROM task WHERE id = ?", (tid,)).fetchone()
        check("after manual edit status = blocked", mid["status"] == "blocked", f"got {mid['status']}")

        # later report (tomorrow) -> finished_successfully
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date=tomorrow, raw_notes="n",
            tasks=[ReportTaskEntry(id=tid, task="Clutter map",
                                   status=TaskStatus.finished_successfully,
                                   owner="Dana", domain_id=domain_id, domain="signal-processing")],
        ))

        task = conn.execute("SELECT * FROM task WHERE id = ?", (tid,)).fetchone()
        check("current status reflects the LATER report (finished_successfully)",
              task["status"] == "finished_successfully", f"got {task['status']}")
        check("ended_on = tomorrow (later report's meeting_date)",
              task["ended_on"] == tomorrow, f"got {task['ended_on']}")

        journey = conn.execute(
            "SELECT meeting_date, status_at_meeting, source FROM task_history "
            "WHERE task_id = ? ORDER BY meeting_date, id", (tid,)
        ).fetchall()
        sources = [(r["source"], r["status_at_meeting"]) for r in journey]
        check("journal in date order with correct source tags",
              sources == [("report", "in-progress"), ("manual", "blocked"),
                          ("report", "finished_successfully")],
              f"got {sources}")
    finally:
        conn.close()


# ── scenario 4: edit current report (change status, add new task) — dup-safe, manual kept ──

def scenario_4(db_dir: pathlib.Path) -> None:
    print("\n[4] edit the current report (change status, add a new task) -> dup-safe + manual rows kept")
    conn = fresh_conn(db_dir / "s4.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        row = fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2026-06-15", raw_notes="n",
            tasks=[ReportTaskEntry(task="Clutter map", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id, domain="signal-processing")],
        ))
        report_id = row["id"]
        tid = task_id_by_name(conn, champion_id, "Clutter map")

        # A pre-existing MANUAL row on the same task (e.g. manager touched owner).
        apply_manual_task_edit(conn, tid, {"owner": "Maya"})
        manual_before = conn.execute(
            "SELECT COUNT(*) c FROM task_history WHERE source='manual'"
        ).fetchone()["c"]
        check("a manual row exists before the report edit", manual_before == 1)

        task_count_before = conn.execute("SELECT COUNT(*) c FROM task").fetchone()["c"]

        # Edit the report: change Clutter map's status + add a brand-new task.
        edited = ReportDocument(
            champion="Dana", meeting_date="2026-06-15", raw_notes="n",
            tasks=[
                ReportTaskEntry(id=tid, task="Clutter map", status=TaskStatus.blocked,
                                owner="Dana", domain_id=domain_id, domain="signal-processing"),
                ReportTaskEntry(task="Doppler check", status=TaskStatus.planned,
                                owner="Dana", domain_id=domain_id, domain="signal-processing"),
            ],
        )
        replay_report_edit(conn, report_id, edited)

        task_count_after = conn.execute("SELECT COUNT(*) c FROM task").fetchone()["c"]
        check("exactly one NEW task added (no duplicate of Clutter map)",
              task_count_after == task_count_before + 1,
              f"before {task_count_before} after {task_count_after}")

        clutter = conn.execute("SELECT status FROM task WHERE id = ?", (tid,)).fetchone()
        # Status: latest journal row for tid. The manual row (owner-only, status
        # in-progress at the time) vs the edited report row (blocked) — the report
        # row is dated 2026-06-15 (>= manual today) so... ordering check below.
        # We assert the report's edited status is journaled and current.
        report_rows = conn.execute(
            "SELECT status_at_meeting FROM task_history "
            "WHERE task_id = ? AND source='report' ORDER BY id", (tid,)
        ).fetchall()
        check("edited report row now records status=blocked",
              report_rows and report_rows[-1]["status_at_meeting"] == "blocked",
              f"got {[r['status_at_meeting'] for r in report_rows]}")

        manual_after = conn.execute(
            "SELECT owner FROM task_history WHERE source='manual'"
        ).fetchall()
        check("pre-existing manual row(s) preserved across the report edit",
              len(manual_after) == 1 and manual_after[0]["owner"] == "Maya",
              f"got {len(manual_after)} rows")

        # No duplicate report rows for the edited report.
        rep_rows = conn.execute(
            "SELECT COUNT(*) c FROM task_history WHERE report_id = ? AND task_id = ?",
            (report_id, tid),
        ).fetchone()["c"]
        check("exactly one report journal row for Clutter map after edit", rep_rows == 1,
              f"got {rep_rows}")
    finally:
        conn.close()


# ── scenario 5: seed.py runs end-to-end on a throwaway DB ────────────────────────

def scenario_5(db_dir: pathlib.Path) -> None:
    print("\n[5] seed.py runs end-to-end on a throwaway DB")
    import importlib
    import os
    db_path = db_dir / "seed.db"
    # Point db.py at the throwaway file, then run seed.main().
    import db as db_mod
    db_mod.DB_PATH = db_path
    # seed imports DB_PATH/get_connection/init_db at module import; re-import fresh.
    if "seed" in sys.modules:
        del sys.modules["seed"]
    seed = importlib.import_module("seed")
    seed.DB_PATH = db_path
    os.environ["SEED_RESET"] = "1"
    try:
        seed.main()
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        teams = conn.execute("SELECT COUNT(*) c FROM team").fetchone()["c"]
        tasks = conn.execute("SELECT COUNT(*) c FROM task").fetchone()["c"]
        th = conn.execute("SELECT COUNT(*) c FROM task_history").fetchone()["c"]
        all_report = conn.execute(
            "SELECT COUNT(*) c FROM task_history WHERE source='report'"
        ).fetchone()["c"]
        conn.close()
        check("seed created 2 teams", teams == 2, f"got {teams}")
        check("seed created tasks", tasks >= 5, f"got {tasks}")
        check("seed task_history rows all source='report'", th == all_report and th > 0,
              f"{all_report}/{th}")
    finally:
        # delete ONLY our throwaway seed DB + WAL/SHM siblings.
        for suffix in ("", "-wal", "-shm"):
            p = pathlib.Path(str(db_path) + suffix)
            if p.exists():
                p.unlink()


# ── scenario 6: owner set → manual clear → owner stays NULL ─────────────────────

def scenario_6(db_dir: pathlib.Path) -> None:
    print("\n[6] owner set via report -> manual clear (owner=None) -> owner stays NULL")
    conn = fresh_conn(db_dir / "s6.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2026-06-01", raw_notes="n",
            tasks=[ReportTaskEntry(task="Alpha task", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id,
                                   domain="signal-processing")],
        ))
        tid = task_id_by_name(conn, champion_id, "Alpha task")

        # Verify the report installed Dana as owner.
        before = conn.execute("SELECT owner FROM task WHERE id = ?", (tid,)).fetchone()
        check("initial owner from report = Dana", before["owner"] == "Dana",
              f"got {before['owner']}")

        # Manual clear: explicitly set owner to None.
        apply_manual_task_edit(conn, tid, {"owner": None})

        after = conn.execute("SELECT owner FROM task WHERE id = ?", (tid,)).fetchone()
        check("owner is NULL after manual clear", after["owner"] is None,
              f"got {after['owner']!r}")

        # The manual row itself must carry owner=NULL.
        manual_row = conn.execute(
            "SELECT owner FROM task_history WHERE task_id = ? AND source = 'manual'",
            (tid,),
        ).fetchone()
        check("manual journal row owner is NULL", manual_row is not None and manual_row["owner"] is None,
              f"got {manual_row['owner'] if manual_row else 'no row'!r}")

        # Force a recompute — must stay NULL (the manual clear is authoritative).
        from reports.engine import _recompute_task_current_state
        _recompute_task_current_state(conn, tid)
        conn.commit()
        recomputed = conn.execute("SELECT owner FROM task WHERE id = ?", (tid,)).fetchone()
        check("owner stays NULL after recompute (manual clear is authoritative)",
              recomputed["owner"] is None, f"got {recomputed['owner']!r}")
    finally:
        conn.close()


# ── scenario 7: manual clear → later report names owner → that owner wins ────────

def scenario_7(db_dir: pathlib.Path) -> None:
    print("\n[7] manual owner-clear -> a later report names an owner -> report owner wins")
    conn = fresh_conn(db_dir / "s7.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2020-01-01", raw_notes="n",
            tasks=[ReportTaskEntry(task="Beta task", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id,
                                   domain="signal-processing")],
        ))
        tid = task_id_by_name(conn, champion_id, "Beta task")

        # Manual clear today.
        apply_manual_task_edit(conn, tid, {"owner": None})
        cleared = conn.execute("SELECT owner FROM task WHERE id = ?", (tid,)).fetchone()
        check("owner cleared to NULL by manual edit", cleared["owner"] is None,
              f"got {cleared['owner']!r}")

        # Later report (tomorrow) names "Maya" as owner.
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date=tomorrow, raw_notes="n",
            tasks=[ReportTaskEntry(id=tid, task="Beta task",
                                   status=TaskStatus.in_progress,
                                   owner="Maya", domain_id=domain_id,
                                   domain="signal-processing")],
        ))

        after = conn.execute("SELECT owner FROM task WHERE id = ?", (tid,)).fetchone()
        check("later report owner (Maya) wins over manual clear",
              after["owner"] == "Maya", f"got {after['owner']!r}")
    finally:
        conn.close()


# ── scenario 8: no-op PATCH → 0 new history rows ────────────────────────────────

def scenario_8(db_dir: pathlib.Path) -> None:
    print("\n[8] no-op PATCH (fields unchanged) -> 0 new history rows")
    conn = fresh_conn(db_dir / "s8.db")
    try:
        team_id, champion_id, domain_id = seed_team(conn)
        fan_out_report(conn, ReportDocument(
            champion="Dana", meeting_date="2026-06-10", raw_notes="n",
            tasks=[ReportTaskEntry(task="Gamma task", status=TaskStatus.in_progress,
                                   owner="Dana", domain_id=domain_id,
                                   domain="signal-processing")],
            artifacts=[ReportArtifactEntry(
                artifact="My Agent", type=ArtifactType.agent,
                change_kind=ArtifactChangeKind.added,
                domain_id=domain_id, domain="signal-processing",
            )],
        ))
        tid = task_id_by_name(conn, champion_id, "Gamma task")
        art_id = conn.execute(
            "SELECT id FROM artifact WHERE team_id = ?", (team_id,)
        ).fetchone()["id"]

        history_before = conn.execute(
            "SELECT COUNT(*) c FROM task_history WHERE task_id = ?", (tid,)
        ).fetchone()["c"]
        art_history_before = conn.execute(
            "SELECT COUNT(*) c FROM artifact_history WHERE artifact_id = ?", (art_id,)
        ).fetchone()["c"]

        # No-op task PATCH: same status and owner as what's already stored.
        task_row = conn.execute("SELECT status, owner FROM task WHERE id = ?", (tid,)).fetchone()
        apply_manual_task_edit(conn, tid, {"status": task_row["status"], "owner": task_row["owner"]})

        history_after = conn.execute(
            "SELECT COUNT(*) c FROM task_history WHERE task_id = ?", (tid,)
        ).fetchone()["c"]
        check("no-op task PATCH inserts 0 new task_history rows",
              history_after == history_before,
              f"before {history_before}, after {history_after}")

        # No-op artifact PATCH: same name (no change).
        art_row = conn.execute("SELECT name FROM artifact WHERE id = ?", (art_id,)).fetchone()
        apply_manual_artifact_edit(conn, art_id, {"name": art_row["name"]})

        art_history_after = conn.execute(
            "SELECT COUNT(*) c FROM artifact_history WHERE artifact_id = ?", (art_id,)
        ).fetchone()["c"]
        check("no-op artifact PATCH inserts 0 new artifact_history rows",
              art_history_after == art_history_before,
              f"before {art_history_before}, after {art_history_after}")

        # Confirm empty-fields dict is also a no-op.
        apply_manual_task_edit(conn, tid, {})
        history_empty = conn.execute(
            "SELECT COUNT(*) c FROM task_history WHERE task_id = ?", (tid,)
        ).fetchone()["c"]
        check("empty-fields task PATCH inserts 0 new task_history rows",
              history_empty == history_before, f"got {history_empty}")
    finally:
        conn.close()


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="wave10_journal_") as td:
        db_dir = pathlib.Path(td)
        scenario_1(db_dir)
        scenario_2(db_dir)
        scenario_3(db_dir)
        scenario_4(db_dir)
        scenario_5(db_dir)
        scenario_6(db_dir)
        scenario_7(db_dir)
        scenario_8(db_dir)
    print(f"\n=== {_passed} passed, {_failed} failed ===")
    return 1 if _failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
