"""Seed the AI Adoption Tracker with the canonical §6 sample data.

Run from src/backend/:
    python seed.py

Expects a FRESH (empty) database — either a newly created tracker.db or one
that has been removed. The script initialises the schema and drives the REAL
``fan_out_report`` path, exactly as the app does.

FLAG — idempotency decision: seed.py targets an EMPTY DB. If tracker.db already
exists the script will attempt to delete it and start from scratch (controlled
by the SEED_RESET env var — default True). Set SEED_RESET=0 to disable the
automatic reset and let it fail if data already exists.

FLAT, id-based world (Wave 9)
-----------------------------
Reports reference EXISTING domains, which are created manually BEFORE the
reports (here via direct inserts). Reports are FLAT: ``tasks`` / ``artifacts`` /
``action_items`` are top-level lists, each entry carrying its own ``domain`` /
``domain_id`` placement and an optional entity ``id``.

A first-mention task/artifact has ``id=None`` (engine creates it and BACK-FILLS
the PK into the saved report_json). A later report that references the SAME
entity passes the now-known ``id`` (read back from the DB after the first save),
so no duplicate is created.

Two teams are seeded:
 1. Radar / Dana / signal-processing — the full §6 canonical trace across two
    meetings (2026-06-08 and 2026-06-15).
 2. Platform / Eli / ci-cd — a small but realistic one-meeting sample.
"""

from __future__ import annotations

import os
import sys

# Seed runs from src/backend/ so the flat-layout modules import cleanly.
# When invoked via `python seed.py` the cwd is src/backend/ and the path is set.
if __name__ == "__main__":
    import pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from db import DB_PATH, get_connection, init_db
from models import (
    ArtifactChangeKind,
    ArtifactType,
    ReportActionItem,
    ReportArtifactEntry,
    ReportDocument,
    ReportTaskEntry,
    TaskStatus,
)
from reports.engine import fan_out_report


# ── reset helper ──────────────────────────────────────────────────────────────

def _reset_db() -> None:
    """Delete tracker.db so we start from a blank slate."""
    if DB_PATH.exists():
        DB_PATH.unlink()
        print(f"[seed] removed existing {DB_PATH}")


# ── entity creation helpers (mirror the management routes' INSERT shape) ──────

def _create_team(conn, name: str, cc_baseline: str | None = None) -> int:
    cur = conn.execute(
        "INSERT INTO team (name, cc_baseline) VALUES (?, ?)",
        (name, cc_baseline),
    )
    conn.commit()
    return cur.lastrowid


def _create_champion(
    conn,
    name: str,
    team_id: int,
    start_date: str | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO champion (name, team_id, start_date) VALUES (?, ?, ?)",
        (name, team_id, start_date),
    )
    conn.commit()
    return cur.lastrowid


def _create_domain(
    conn,
    team_id: int,
    champion_id: int,
    name: str,
    description: str | None = None,
    priority: str | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO domain (team_id, champion_id, name, description, priority) "
        "VALUES (?, ?, ?, ?, ?)",
        (team_id, champion_id, name, description, priority),
    )
    conn.commit()
    return cur.lastrowid


def _task_id_by_name(conn, champion_id: int, name: str) -> int:
    """Read back a task's PK after a fan-out so a later report can reference it."""
    row = conn.execute(
        "SELECT t.id FROM task t JOIN domain d ON d.id = t.domain_id "
        "WHERE d.champion_id = ? AND t.name = ?",
        (champion_id, name),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"[seed] expected task {name!r} to exist after fan-out")
    return row["id"]


# ── Radar / Dana ──────────────────────────────────────────────────────────────

def seed_radar(conn) -> None:
    """Seed team Radar, champion Dana, domain signal-processing.

    Two meetings following the §6 worked-example trace:

    Meeting 06-08 (report 1):
      - Clutter map: in-progress ("first draft of map") — first mention (id=None).

    Meeting 06-15 (report 2):
      - CFAR tuning: abandoned, finished_on 2026-06-15 (first mention, id=None).
      - Clutter map: in-progress (still going) — references the SAME task by the
        id back-filled from report 1.
      - Doppler check: planned (first mention, id=None).
      - clutter-review: skill, added (first mention, id=None).
      - action item: "find a context-usage tool".

    FLAG (unchanged from the original seed): the §6 illustration shows
    started_on = 06-01 for CFAR tuning / Clutter map, but the engine derives
    started_on from the EARLIEST report date that mentions the task. We have no
    06-01 report, so started_on is 06-08 for Clutter map and 06-15 for CFAR.
    The trace intent (CFAR abandoned 06-15, Clutter map in-progress, Doppler
    planned, clutter-review added) is preserved exactly.
    """
    print("[seed] creating Radar team …")
    team_id = _create_team(
        conn,
        name="Radar",
        cc_baseline="Team uses Claude Code ad-hoc for scripts; no structured skills or agents yet.",
    )
    champion_id = _create_champion(conn, name="Dana", team_id=team_id, start_date="2026-05-01")
    domain_id = _create_domain(
        conn,
        team_id=team_id,
        champion_id=champion_id,
        name="signal-processing",
        description="DSP pipeline work including CFAR, clutter mapping, and Doppler analysis.",
        priority="1",
    )
    print(f"[seed]   team={team_id}  champion={champion_id} (Dana)  domain={domain_id}")

    # ── meeting 06-08 ─────────────────────────────────────────────────────────
    print("[seed] fanning out 2026-06-08 report (Radar/Dana) …")
    doc_0608 = ReportDocument(
        champion="Dana",
        meeting_date="2026-06-08",
        participants=["Dana", "Omer"],
        raw_notes=(
            "Clutter map work started this week — produced the first draft of "
            "the map; still a lot to refine.  CFAR tuning is stalling, not sure "
            "it's worth pursuing.  Nothing else new."
        ),
        tasks=[
            ReportTaskEntry(
                task="Clutter map",
                status=TaskStatus.in_progress,
                owner="Dana",
                note="first draft of map",
                domain_id=domain_id,
                domain="signal-processing",
            ),
        ],
    )
    row1 = fan_out_report(conn, doc_0608)
    print(f"[seed]   saved report id={row1['id']}")

    # Read back the id the engine assigned to Clutter map so report 2 references
    # the SAME task by id (proving the no-duplicate id path).
    clutter_map_id = _task_id_by_name(conn, champion_id, "Clutter map")
    print(f"[seed]   Clutter map task id={clutter_map_id} (referenced by report 2)")

    # ── meeting 06-15 ─────────────────────────────────────────────────────────
    print("[seed] fanning out 2026-06-15 report (Radar/Dana) …")
    doc_0615 = ReportDocument(
        champion="Dana",
        meeting_date="2026-06-15",
        participants=["Dana", "Omer"],
        raw_notes=(
            "CFAR tuning is being retired — not worth continuing.  "
            "Clutter map is still going; ran first pilot this week.  "
            "Starting a new Doppler check task instead.  "
            "Created clutter-review skill to speed up review cycles."
        ),
        tasks=[
            ReportTaskEntry(
                task="CFAR tuning",
                status=TaskStatus.abandoned,
                owner="Dana",
                note="retired — not worth continuing",
                finished_on="2026-06-15",
                domain_id=domain_id,
                domain="signal-processing",
            ),
            ReportTaskEntry(
                id=clutter_map_id,  # existing task — id-match, no duplicate
                task="Clutter map",
                status=TaskStatus.in_progress,
                owner="Dana",
                note="still going; ran first pilot",
                domain_id=domain_id,
                domain="signal-processing",
            ),
            ReportTaskEntry(
                task="Doppler check",
                status=TaskStatus.planned,
                owner="Dana",
                note="started instead",
                domain_id=domain_id,
                domain="signal-processing",
            ),
        ],
        artifacts=[
            ReportArtifactEntry(
                artifact="clutter-review",
                type=ArtifactType.skill,
                tags=["under_test"],
                change_kind=ArtifactChangeKind.added,
                summary="Skill that speeds up clutter-map review cycles.",
                note="created to speed review",
                domain_id=domain_id,
                domain="signal-processing",
            ),
        ],
        action_items=[
            ReportActionItem(
                text="find a context-usage tool",
                owner="Omer",
                domain_id=domain_id,
                domain="signal-processing",
            ),
        ],
        discussion=["demoed a meta-skill"],
        issues=["champion flagged repo-access problem"],
    )
    row2 = fan_out_report(conn, doc_0615)
    print(f"[seed]   saved report id={row2['id']}")


# ── Platform / Eli ────────────────────────────────────────────────────────────

def seed_platform(conn) -> None:
    """Seed team Platform, champion Eli, domain ci-cd.

    One meeting (2026-06-12) with two tasks and one artifact — small but
    realistic breadth example.

    FLAG — invented details: Platform/Eli domain and content are not specified
    in spec.md §4/§6.  The following were chosen to be realistic and minimal:
      domain = ci-cd
      tasks  = Pipeline health check (in-progress), Deploy gate review (planned)
      artifact = deploy-gate-hook (hook type, added)
    """
    print("[seed] creating Platform team …")
    team_id = _create_team(
        conn,
        name="Platform",
        cc_baseline="Team uses Claude Code for PR descriptions; no automation skills yet.",
    )
    champion_id = _create_champion(conn, name="Eli", team_id=team_id, start_date="2026-05-15")
    domain_id = _create_domain(
        conn,
        team_id=team_id,
        champion_id=champion_id,
        name="ci-cd",
        description="Continuous integration and deployment pipeline automation.",
        priority="1",
    )
    print(f"[seed]   team={team_id}  champion={champion_id} (Eli)  domain={domain_id}")

    print("[seed] fanning out 2026-06-12 report (Platform/Eli) …")
    doc = ReportDocument(
        champion="Eli",
        meeting_date="2026-06-12",
        participants=["Eli", "Omer"],
        raw_notes=(
            "Started reviewing the pipeline health check using Claude.  "
            "Identified deploy gate as the next thing to tackle.  "
            "Created a hook to automate deploy gate validation."
        ),
        tasks=[
            ReportTaskEntry(
                task="Pipeline health check",
                status=TaskStatus.in_progress,
                owner="Eli",
                note="initial review underway",
                domain_id=domain_id,
                domain="ci-cd",
            ),
            ReportTaskEntry(
                task="Deploy gate review",
                status=TaskStatus.planned,
                owner="Eli",
                note="queued after pipeline health check",
                domain_id=domain_id,
                domain="ci-cd",
            ),
        ],
        artifacts=[
            ReportArtifactEntry(
                artifact="deploy-gate-hook",
                type=ArtifactType.hook,
                tags=["under_test"],
                change_kind=ArtifactChangeKind.added,
                summary="Hook that validates the deploy gate before promotion.",
                note="automates deploy gate validation",
                domain_id=domain_id,
                domain="ci-cd",
            ),
        ],
        action_items=[
            ReportActionItem(
                text="share deploy-gate-hook design with Radar team",
                owner="Eli",
                domain_id=domain_id,
                domain="ci-cd",
            ),
        ],
    )
    row = fan_out_report(conn, doc)
    print(f"[seed]   saved report id={row['id']}")


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    seed_reset = os.environ.get("SEED_RESET", "1").strip().lower() not in ("0", "false", "no", "off")

    if seed_reset:
        _reset_db()
    else:
        print("[seed] SEED_RESET=0 — keeping existing database (will fail if data exists)")

    print("[seed] initialising schema …")
    init_db()

    conn = get_connection()
    try:
        seed_radar(conn)
        seed_platform(conn)
    finally:
        conn.close()

    print("[seed] done — database ready at", DB_PATH)


if __name__ == "__main__":
    main()
