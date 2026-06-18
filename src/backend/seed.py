"""Seed the AI Adoption Tracker with the canonical §6 sample data.

Run from src/backend/:
    python seed.py

Expects a FRESH (empty) database — either a newly created tracker.db or one
that has been removed. The script will initialise the schema and fail loudly
if any required entity already exists, because it inserts by name and the engine
will find duplicates that break the §6 trace.

FLAG — idempotency decision: seed.py targets an EMPTY DB. If tracker.db already
exists the script will attempt to delete it and start from scratch (controlled
by the SEED_RESET env var — default True). Set SEED_RESET=0 to disable the
automatic reset and let it fail if data already exists.

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
    ReportDomainSection,
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
    scope: str | None = None,
    priority: int | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO domain (team_id, champion_id, name, description, scope, priority) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (team_id, champion_id, name, description, scope, priority),
    )
    conn.commit()
    return cur.lastrowid


# ── Radar / Dana ──────────────────────────────────────────────────────────────

def seed_radar(conn) -> None:
    """Seed team Radar, champion Dana, domain signal-processing.

    Two meetings following the §6 worked-example trace:

    Meeting 06-08 (report 1):
      - Clutter map: in-progress ("first draft of map")
      CFAR tuning does NOT appear in the first meeting — per §6, its
      started_on = 06-01 which pre-dates our seed window, but the spec's
      task_history table shows only report 41 (06-08) for Clutter map and
      report 42 (06-15) for CFAR tuning / Doppler check.  We faithfully
      reproduce that: CFAR tuning first appears on 06-15 (already started
      elsewhere, flagged here as started 06-01 in the spec history table —
      but started_on is derived as the earliest report date, so we accept
      that in our seed started_on = 06-15 for CFAR, which differs from the
      §6 illustration.  FLAG: the §6 table shows started_on = 06-01 for
      CFAR tuning but the engine derives started_on from the earliest report
      date — we have no 06-01 report so started_on will be 06-15 here.
      The trace intent (abandoned on 06-15) is preserved.)

    Meeting 06-15 (report 2):
      - CFAR tuning: abandoned, finished_on 2026-06-15
      - Clutter map: in-progress (still going)
      - Doppler check: planned
      - clutter-review: skill, added
      - action item: "find a context-usage tool"
    """
    print("[seed] creating Radar team …")
    team_id = _create_team(
        conn,
        name="Radar",
        cc_baseline="Team uses Claude Code ad-hoc for scripts; no structured skills or agents yet.",
    )
    champion_id = _create_champion(conn, name="Dana", team_id=team_id, start_date="2026-05-01")
    _create_domain(
        conn,
        team_id=team_id,
        champion_id=champion_id,
        name="signal-processing",
        description="DSP pipeline work including CFAR, clutter mapping, and Doppler analysis.",
        scope="All signal-chain tasks from raw ADC to target detection.",
        priority=1,
    )
    print(f"[seed]   team={team_id}  champion={champion_id} (Dana)")

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
        domains=[
            ReportDomainSection(
                domain="signal-processing",
                tasks=[
                    ReportTaskEntry(
                        task="Clutter map",
                        status=TaskStatus.in_progress,
                        owner="Dana",
                        note="first draft of map",
                    ),
                ],
            )
        ],
    )
    row1 = fan_out_report(conn, doc_0608)
    print(f"[seed]   saved report id={row1['id']}")

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
        domains=[
            ReportDomainSection(
                domain="signal-processing",
                tasks=[
                    ReportTaskEntry(
                        task="CFAR tuning",
                        status=TaskStatus.abandoned,
                        owner="Dana",
                        note="retired — not worth continuing",
                        finished_on="2026-06-15",
                    ),
                    ReportTaskEntry(
                        task="Clutter map",
                        status=TaskStatus.in_progress,
                        owner="Dana",
                        note="still going; ran first pilot",
                    ),
                    ReportTaskEntry(
                        task="Doppler check",
                        status=TaskStatus.planned,
                        owner="Dana",
                        note="started instead",
                    ),
                ],
                artifacts=[
                    ReportArtifactEntry(
                        artifact="clutter-review",
                        type=ArtifactType.skill,
                        tags=["under_test"],
                        change_kind=ArtifactChangeKind.added,
                        note="created to speed review",
                    ),
                ],
            )
        ],
        action_items=[
            ReportActionItem(
                text="find a context-usage tool",
                owner="Omer",
                domain="signal-processing",
            ),
        ],
        discussion="demoed a meta-skill",
        issues="champion flagged repo-access problem",
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
    _create_domain(
        conn,
        team_id=team_id,
        champion_id=champion_id,
        name="ci-cd",
        description="Continuous integration and deployment pipeline automation.",
        scope="Build, test, and deploy gates for the platform services.",
        priority=1,
    )
    print(f"[seed]   team={team_id}  champion={champion_id} (Eli)")

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
        domains=[
            ReportDomainSection(
                domain="ci-cd",
                tasks=[
                    ReportTaskEntry(
                        task="Pipeline health check",
                        status=TaskStatus.in_progress,
                        owner="Eli",
                        note="initial review underway",
                    ),
                    ReportTaskEntry(
                        task="Deploy gate review",
                        status=TaskStatus.planned,
                        owner="Eli",
                        note="queued after pipeline health check",
                    ),
                ],
                artifacts=[
                    ReportArtifactEntry(
                        artifact="deploy-gate-hook",
                        type=ArtifactType.hook,
                        tags=["under_test"],
                        change_kind=ArtifactChangeKind.added,
                        note="automates deploy gate validation",
                    ),
                ],
            )
        ],
        action_items=[
            ReportActionItem(
                text="share deploy-gate-hook design with Radar team",
                owner="Eli",
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
