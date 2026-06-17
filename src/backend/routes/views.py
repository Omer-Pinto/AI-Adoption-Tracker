"""Views & lists API — team/domain pages, task & artifact lists/details.

Wave-1 Agent 1B. Implements API contract §2 (Views & lists). Read-only
endpoints over the §5 storage tables: the landing index, the team page (a
champion's portfolio labeled by team), the domain page, and the task/artifact
list + detail endpoints.

The two list endpoints (`/tasks`, `/artifacts`) accept the optional `q` DSL and
delegate filtering to Agent 1D's `search` package via the
`filter_tasks` / `filter_artifacts` / `ParseError` seam — this module never
implements the DSL itself. All other endpoints are self-contained here.

`{id}` on the team page is the CHAMPION id: the page is a champion's portfolio
of domains, labeled by the team (spec §7, "keyed internally by champion,
labeled by team"). The team is derived from the champion.
"""

from __future__ import annotations

import json
import sqlite3

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

import models
from db import get_connection

# Cross-agent seam (Agent 1D's `search` package). 1D adapts the vendored DSL
# engine to expose these helpers; until then this import resolves against the
# package but the names may be absent in an isolated worktree (verified at
# merge). See agent report.
from search import ParseError, filter_artifacts, filter_tasks

router = APIRouter(prefix="/api", tags=["views"])


# ── local composite response models (not in models.py) ──────────────────────
# Field names match the contract §2 shapes EXACTLY.

class TeamPageIndexEntry(BaseModel):
    """One landing-index entry per (team, champion) pair (contract §2)."""
    team_id: int
    team_name: str
    champion_id: int
    champion_name: str
    domain_count: int


class DomainBlock(BaseModel):
    """One domain's slice of a team page: current state + full journey."""
    domain: models.Domain
    tasks: list[models.Task]
    task_history: list[models.TaskHistory]
    artifacts: list[models.Artifact]
    artifact_history: list[models.ArtifactHistory]


class TeamPage(BaseModel):
    """The hub: a champion's portfolio of domains, labeled by team (contract §2)."""
    team: models.Team
    champion: models.Champion
    domains: list[DomainBlock]
    all_team_artifacts: list[models.Artifact]
    reports: list[models.Report]
    action_items: list[models.ActionItem]


class DomainPage(BaseModel):
    """Drill-in for a single domain (contract §2)."""
    domain: models.Domain
    tasks: list[models.Task]
    task_history: list[models.TaskHistory]
    artifacts: list[models.Artifact]
    artifact_history: list[models.ArtifactHistory]


class TaskDetail(BaseModel):
    """A task plus its week-by-week journey (contract §2)."""
    task: models.Task
    history: list[models.TaskHistory]


class ArtifactDetail(BaseModel):
    """An artifact plus its change history (contract §2)."""
    artifact: models.Artifact
    history: list[models.ArtifactHistory]


# `from __future__ import annotations` makes the model field annotations strings;
# rebuild so pydantic resolves the `models.*` forward references at import time.
for _m in (DomainBlock, TeamPage, DomainPage, TaskDetail, ArtifactDetail):
    _m.model_rebuild()


# ── row → model mappers ──────────────────────────────────────────────────────

def _team(row: sqlite3.Row) -> models.Team:
    return models.Team(**dict(row))


def _champion(row: sqlite3.Row) -> models.Champion:
    return models.Champion(**dict(row))


def _domain(row: sqlite3.Row) -> models.Domain:
    return models.Domain(**dict(row))


def _report(row: sqlite3.Row) -> models.Report:
    return models.Report(**dict(row))


def _task(row: sqlite3.Row) -> models.Task:
    return models.Task(**dict(row))


def _task_history(row: sqlite3.Row) -> models.TaskHistory:
    return models.TaskHistory(**dict(row))


def _artifact(row: sqlite3.Row) -> models.Artifact:
    d = dict(row)
    # `tags` is JSON text in the DB ("null" / null / "[...]"); the model wants a
    # list[str]. Parse it here so the wire shape is a JSON array; "", NULL and a
    # literal "null" all collapse to [].
    raw = d.get("tags")
    d["tags"] = json.loads(raw) or [] if raw else []
    return models.Artifact(**d)


def _artifact_history(row: sqlite3.Row) -> models.ArtifactHistory:
    return models.ArtifactHistory(**dict(row))


def _action_item(row: sqlite3.Row) -> models.ActionItem:
    d = dict(row)
    d["resolved"] = bool(d.get("resolved"))
    return models.ActionItem(**d)


# ── per-domain history fetchers (reached via task/artifact; no domain_id) ─────
# History tables carry no domain_id; reach the domain through task/artifact.
# Ordered by meeting_date, then id for a stable order on same-date ties.

def _tasks_for_domain(conn: sqlite3.Connection, domain_id: int) -> list[models.Task]:
    rows = conn.execute(
        "SELECT * FROM task WHERE domain_id = ? ORDER BY id", (domain_id,)
    ).fetchall()
    return [_task(r) for r in rows]


def _task_history_for_domain(
    conn: sqlite3.Connection, domain_id: int
) -> list[models.TaskHistory]:
    rows = conn.execute(
        """
        SELECT th.* FROM task_history th
        JOIN task t ON t.id = th.task_id
        WHERE t.domain_id = ?
        ORDER BY th.meeting_date, th.id
        """,
        (domain_id,),
    ).fetchall()
    return [_task_history(r) for r in rows]


def _artifacts_for_domain(
    conn: sqlite3.Connection, domain_id: int
) -> list[models.Artifact]:
    rows = conn.execute(
        "SELECT * FROM artifact WHERE domain_id = ? ORDER BY id", (domain_id,)
    ).fetchall()
    return [_artifact(r) for r in rows]


def _artifact_history_for_domain(
    conn: sqlite3.Connection, domain_id: int
) -> list[models.ArtifactHistory]:
    rows = conn.execute(
        """
        SELECT ah.* FROM artifact_history ah
        JOIN artifact a ON a.id = ah.artifact_id
        WHERE a.domain_id = ?
        ORDER BY ah.meeting_date, ah.id
        """,
        (domain_id,),
    ).fetchall()
    return [_artifact_history(r) for r in rows]


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/team-pages", response_model=list[TeamPageIndexEntry])
def list_team_pages() -> list[TeamPageIndexEntry]:
    """Landing index: one entry per (team, champion) pair (contract §2).

    A team split across two champions yields two entries. `domain_count` counts
    the champion's own domains (domain.champion_id).
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT
                t.id   AS team_id,
                t.name AS team_name,
                c.id   AS champion_id,
                c.name AS champion_name,
                (SELECT COUNT(*) FROM domain d WHERE d.champion_id = c.id)
                    AS domain_count
            FROM champion c
            JOIN team t ON t.id = c.team_id
            ORDER BY t.name, c.name, c.id
            """
        ).fetchall()
        return [TeamPageIndexEntry(**dict(r)) for r in rows]
    finally:
        conn.close()


@router.get("/teams/{id}/page", response_model=TeamPage)
def team_page(id: int) -> TeamPage:
    """The hub for one champion's portfolio. `{id}` is the CHAMPION id.

    Derives the team from the champion. Returns each domain with current
    tasks/artifacts plus full history, the all-team gutter (team artifacts with
    domain_id NULL), the champion's reports (newest first), and action items
    from that champion's reports.
    """
    conn = get_connection()
    try:
        champ_row = conn.execute(
            "SELECT * FROM champion WHERE id = ?", (id,)
        ).fetchone()
        if champ_row is None:
            raise HTTPException(status_code=404, detail="Champion not found")
        champion = _champion(champ_row)

        team_row = conn.execute(
            "SELECT * FROM team WHERE id = ?", (champion.team_id,)
        ).fetchone()
        if team_row is None:
            # Champion's team missing is a data-integrity 404 (FK should prevent).
            raise HTTPException(status_code=404, detail="Team not found")
        team = _team(team_row)

        domain_rows = conn.execute(
            "SELECT * FROM domain WHERE champion_id = ? ORDER BY priority, id",
            (id,),
        ).fetchall()
        domains: list[DomainBlock] = []
        for d_row in domain_rows:
            domain = _domain(d_row)
            domains.append(
                DomainBlock(
                    domain=domain,
                    tasks=_tasks_for_domain(conn, domain.id),
                    task_history=_task_history_for_domain(conn, domain.id),
                    artifacts=_artifacts_for_domain(conn, domain.id),
                    artifact_history=_artifact_history_for_domain(conn, domain.id),
                )
            )

        # All-team gutter: this champion's team's artifacts with no domain.
        gutter_rows = conn.execute(
            "SELECT * FROM artifact WHERE team_id = ? AND domain_id IS NULL ORDER BY id",
            (team.id,),
        ).fetchall()
        all_team_artifacts = [_artifact(r) for r in gutter_rows]

        report_rows = conn.execute(
            "SELECT * FROM report WHERE champion_id = ? ORDER BY meeting_date DESC, id DESC",
            (id,),
        ).fetchall()
        reports = [_report(r) for r in report_rows]

        action_rows = conn.execute(
            """
            SELECT ai.* FROM action_item ai
            JOIN report r ON r.id = ai.report_id
            WHERE r.champion_id = ?
            ORDER BY ai.id
            """,
            (id,),
        ).fetchall()
        action_items = [_action_item(r) for r in action_rows]

        return TeamPage(
            team=team,
            champion=champion,
            domains=domains,
            all_team_artifacts=all_team_artifacts,
            reports=reports,
            action_items=action_items,
        )
    finally:
        conn.close()


@router.get("/domains/{id}/page", response_model=DomainPage)
def domain_page(id: int) -> DomainPage:
    """Drill into a single domain: current tasks/artifacts + full history."""
    conn = get_connection()
    try:
        d_row = conn.execute(
            "SELECT * FROM domain WHERE id = ?", (id,)
        ).fetchone()
        if d_row is None:
            raise HTTPException(status_code=404, detail="Domain not found")
        domain = _domain(d_row)
        return DomainPage(
            domain=domain,
            tasks=_tasks_for_domain(conn, id),
            task_history=_task_history_for_domain(conn, id),
            artifacts=_artifacts_for_domain(conn, id),
            artifact_history=_artifact_history_for_domain(conn, id),
        )
    finally:
        conn.close()


@router.get("/tasks", response_model=list[models.Task])
def list_tasks(q: str | None = Query(default=None)) -> list[models.Task]:
    """All current-state tasks; optional `q` DSL filter (Agent 1D's search).

    `q` absent/empty → full list. An unknown DSL key raises `ParseError`, which
    we surface as 422.
    """
    conn = get_connection()
    try:
        return filter_tasks(conn, q)
    except ParseError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        conn.close()


@router.get("/tasks/{id}", response_model=TaskDetail)
def task_detail(id: int) -> TaskDetail:
    """A task plus its week-by-week journey (history ordered by meeting_date)."""
    conn = get_connection()
    try:
        t_row = conn.execute("SELECT * FROM task WHERE id = ?", (id,)).fetchone()
        if t_row is None:
            raise HTTPException(status_code=404, detail="Task not found")
        history_rows = conn.execute(
            "SELECT * FROM task_history WHERE task_id = ? ORDER BY meeting_date, id",
            (id,),
        ).fetchall()
        return TaskDetail(
            task=_task(t_row),
            history=[_task_history(r) for r in history_rows],
        )
    finally:
        conn.close()


@router.get("/artifacts", response_model=list[models.Artifact])
def list_artifacts(q: str | None = Query(default=None)) -> list[models.Artifact]:
    """All current-state artifacts; optional `q` DSL filter (Agent 1D's search).

    `q` absent/empty → full list. An unknown DSL key raises `ParseError`, which
    we surface as 422.
    """
    conn = get_connection()
    try:
        return filter_artifacts(conn, q)
    except ParseError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        conn.close()


@router.get("/artifacts/{id}", response_model=ArtifactDetail)
def artifact_detail(id: int) -> ArtifactDetail:
    """An artifact plus its change history (ordered by meeting_date)."""
    conn = get_connection()
    try:
        a_row = conn.execute(
            "SELECT * FROM artifact WHERE id = ?", (id,)
        ).fetchone()
        if a_row is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        history_rows = conn.execute(
            "SELECT * FROM artifact_history WHERE artifact_id = ? ORDER BY meeting_date, id",
            (id,),
        ).fetchall()
        return ArtifactDetail(
            artifact=_artifact(a_row),
            history=[_artifact_history(r) for r in history_rows],
        )
    finally:
        conn.close()
