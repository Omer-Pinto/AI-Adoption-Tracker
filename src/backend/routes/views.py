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

from models import ArtifactType, TaskStatus

import models
from db import get_connection
from domain_helpers import build_domain

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
    """A task plus its week-by-week journey (contract §2).

    `domain` is the task's domain name (resolved via task.domain_id), surfaced so
    the entity detail page can label the placement without a second round-trip.
    """
    task: models.Task
    domain: str | None = None
    history: list[models.TaskHistory]


class ArtifactDetail(BaseModel):
    """An artifact plus its change history (contract §2).

    `domain` is the artifact's domain name (null when domain_id is null = the
    team-wide gutter), surfaced for the entity detail page's placement label.
    """
    artifact: models.Artifact
    domain: str | None = None
    history: list[models.ArtifactHistory]


# ── Wave-10 entity-picker projection (NOT the full entity models) ────────────
# Picker-shaped rows for the report editor's @-task / #-artifact mentions: only
# the fields the picker renders, plus the resolved domain name.

class EntityPickerTask(BaseModel):
    """One task as the picker sees it: id, name, status, domain placement."""
    id: int
    name: str
    status: str
    domain_id: int
    domain: str | None = None


class EntityPickerArtifact(BaseModel):
    """One artifact as the picker sees it: id, name, type, domain placement.

    `domain_id` is null for team-wide artifacts (then `domain` is null too).
    """
    id: int
    name: str
    type: str
    domain_id: int | None = None
    domain: str | None = None


class TeamEntities(BaseModel):
    """A team's existing tasks + artifacts as picker-shaped projections."""
    tasks: list[EntityPickerTask]
    artifacts: list[EntityPickerArtifact]


# ── Wave-10 current-state PATCH request models (all-optional partial patch) ───

class TaskPatch(BaseModel):
    """Manager edit for a task's current state: `status`, `owner`, `domain_id`,
    `started_on`, `ended_on` are all editable (partial PATCH).

    This is the manager's direct current-state edit handle. The edit is saved to
    current-state but is intentionally UN-JOURNALED: reports remain the only thing
    that writes `task_history`. The owner accepts that a later report-edit replay
    may recompute these fields.

    `status` is typed as `TaskStatus`, so an invalid enum value is rejected as 422
    by Pydantic. All fields optional; only supplied fields are written via
    `model_dump(exclude_unset=True)`.
    """
    status: TaskStatus | None = None
    owner: str | None = None
    domain_id: int | None = None
    started_on: str | None = None
    ended_on: str | None = None


class ArtifactPatch(BaseModel):
    """Entity-page edit for an artifact: name/type/tags/summary/domain_id.

    `domain_id` is nullable (null = team-wide). All fields optional (partial
    PATCH); only supplied fields are written.
    """
    name: str | None = None
    type: str | None = None
    tags: list[str] | None = None
    summary: str | None = None
    domain_id: int | None = None


# `from __future__ import annotations` makes the model field annotations strings;
# rebuild so pydantic resolves the `models.*` forward references at import time.
for _m in (DomainBlock, TeamPage, DomainPage, TaskDetail, ArtifactDetail):
    _m.model_rebuild()


# ── row → model mappers ──────────────────────────────────────────────────────

def _team(row: sqlite3.Row) -> models.Team:
    return models.Team(**dict(row))


def _champion(row: sqlite3.Row) -> models.Champion:
    return models.Champion(**dict(row))


def _domain(conn: sqlite3.Connection, domain_id: int) -> models.Domain:
    """Build the enriched Domain model (team_name + cross_domains) for `domain_id`."""
    return build_domain(conn, domain_id)


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


# ── Wave-10 helpers ──────────────────────────────────────────────────────────

def _domain_name(conn: sqlite3.Connection, domain_id: int | None) -> str | None:
    """Resolve a domain's name; None for a null/unknown domain_id."""
    if domain_id is None:
        return None
    row = conn.execute(
        "SELECT name FROM domain WHERE id = ?", (domain_id,)
    ).fetchone()
    return row["name"] if row is not None else None


def _patch_update(
    conn: sqlite3.Connection, table: str, row_id: int, changes: dict
) -> None:
    """UPDATE only the supplied columns of `table` row `row_id` (partial PATCH).

    Mirrors `management._update`; kept local to views.py to avoid a cross-module
    import for a one-liner. No-op when `changes` is empty.
    """
    if not changes:
        return
    assignments = ", ".join(f"{c} = ?" for c in changes)
    conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ?",
        [*changes.values(), row_id],
    )


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

        domain_id_rows = conn.execute(
            "SELECT id FROM domain WHERE champion_id = ? ORDER BY priority IS NULL, priority, id",
            (id,),
        ).fetchall()
        domains: list[DomainBlock] = []
        for d_id_row in domain_id_rows:
            domain = _domain(conn, d_id_row["id"])
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
        domain = _domain(conn, id)
        if domain is None:
            raise HTTPException(status_code=404, detail="Domain not found")
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
            domain=_domain_name(conn, t_row["domain_id"]),
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
            domain=_domain_name(conn, a_row["domain_id"]),
            history=[_artifact_history(r) for r in history_rows],
        )
    finally:
        conn.close()


# ── Wave-10: report-editor entity picker + current-state edits ───────────────

@router.get("/teams/{team_id}/entities", response_model=TeamEntities)
def team_entities(team_id: int) -> TeamEntities:
    """The team's existing tasks + artifacts as a picker-shaped projection.

    Feeds the report editor's `@`-task / `#`-artifact mentions. NOT the full
    entity models — only id/name/status|type and the resolved domain.

    Tasks reach the team via task → domain → domain.team_id (tasks have no direct
    team_id). Artifacts via artifact.team_id, including team-wide artifacts
    (domain_id null → domain null). `domain` is the domain name via LEFT JOIN.

    404 if the team does not exist; an empty team yields empty lists (200).
    """
    conn = get_connection()
    try:
        if conn.execute(
            "SELECT 1 FROM team WHERE id = ?", (team_id,)
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail="Team not found")

        task_rows = conn.execute(
            """
            SELECT t.id, t.name, t.status, t.domain_id, d.name AS domain
            FROM task t
            JOIN domain d ON d.id = t.domain_id
            WHERE d.team_id = ?
            ORDER BY t.id
            """,
            (team_id,),
        ).fetchall()
        tasks = [EntityPickerTask(**dict(r)) for r in task_rows]

        artifact_rows = conn.execute(
            """
            SELECT a.id, a.name, a.type, a.domain_id, d.name AS domain
            FROM artifact a
            LEFT JOIN domain d ON d.id = a.domain_id
            WHERE a.team_id = ?
            ORDER BY a.id
            """,
            (team_id,),
        ).fetchall()
        artifacts = [EntityPickerArtifact(**dict(r)) for r in artifact_rows]

        return TeamEntities(tasks=tasks, artifacts=artifacts)
    finally:
        conn.close()


@router.patch("/tasks/{id}", response_model=models.Task)
def patch_task(id: int, body: TaskPatch) -> models.Task:
    """Manager edit for a task's current state — NO history row written.

    This is a management tool: the manager edits current-state directly. Accepts
    `status` (validated against `TaskStatus`), `owner`, `domain_id`, `started_on`,
    `ended_on` (partial PATCH). The edit is saved to current-state but is
    intentionally UN-JOURNALED — reports remain the only thing that journals
    `task_history` (a later report-edit replay may recompute these fields).

    A non-null `domain_id` must exist (else 422) and its team must equal the task's
    current team (via current domain) else 422 cross-team. 404 if the task is
    missing. History is report-only — this writes none.
    """
    conn = get_connection()
    try:
        task_row = conn.execute(
            "SELECT * FROM task WHERE id = ?", (id,)
        ).fetchone()
        if task_row is None:
            raise HTTPException(status_code=404, detail="Task not found")

        changes = body.model_dump(exclude_unset=True)

        # `status` arrives as a TaskStatus enum (Pydantic already rejected an
        # invalid value as 422); persist its string value in the TEXT column.
        if "status" in changes and changes["status"] is not None:
            changes["status"] = changes["status"].value

        # owner / status may be edited freely; null owner clears the owner.

        if "domain_id" in changes:
            new_domain_id = changes["domain_id"]
            if new_domain_id is None:
                # task.domain_id is NOT NULL — a task must stay placed.
                raise HTTPException(
                    status_code=422, detail="domain_id cannot be null"
                )
            new_dom = conn.execute(
                "SELECT team_id FROM domain WHERE id = ?", (new_domain_id,)
            ).fetchone()
            if new_dom is None:
                raise HTTPException(
                    status_code=422, detail=f"Unknown domain id {new_domain_id}"
                )
            # Cross-team guard: resolve the task's current team via its current
            # domain, then require the new domain to share it.
            cur_dom = conn.execute(
                "SELECT team_id FROM domain WHERE id = ?", (task_row["domain_id"],)
            ).fetchone()
            if cur_dom is not None and new_dom["team_id"] != cur_dom["team_id"]:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"domain {new_domain_id} belongs to team "
                        f"{new_dom['team_id']}, not the task's team "
                        f"{cur_dom['team_id']}"
                    ),
                )

        _patch_update(conn, "task", id, changes)
        conn.commit()
        row = conn.execute("SELECT * FROM task WHERE id = ?", (id,)).fetchone()
        return _task(row)
    finally:
        conn.close()


@router.patch("/artifacts/{id}", response_model=models.Artifact)
def patch_artifact(id: int, body: ArtifactPatch) -> models.Artifact:
    """Entity-page edit for an artifact — current-state only, NO history row.

    Accepts `name`, `type`, `tags`, `summary`, `domain_id` (partial). `type` is
    validated by the `ArtifactType` enum. `tags` is re-serialized to JSON text on
    write. A non-null `domain_id` must exist and its team must equal the
    artifact's team else 422; null is allowed (team-wide). 404 if missing. History
    is report-only — this writes none.
    """
    conn = get_connection()
    try:
        artifact_row = conn.execute(
            "SELECT * FROM artifact WHERE id = ?", (id,)
        ).fetchone()
        if artifact_row is None:
            raise HTTPException(status_code=404, detail="Artifact not found")

        changes = body.model_dump(exclude_unset=True)

        for field in ("name", "type"):
            if field in changes and changes[field] is None:
                raise HTTPException(
                    status_code=422, detail=f"{field} cannot be null"
                )

        if "type" in changes:
            try:
                ArtifactType(changes["type"])
            except ValueError:
                raise HTTPException(
                    status_code=422,
                    detail=f"Unknown artifact type {changes['type']!r}",
                )

        if "domain_id" in changes and changes["domain_id"] is not None:
            new_domain_id = changes["domain_id"]
            new_dom = conn.execute(
                "SELECT team_id FROM domain WHERE id = ?", (new_domain_id,)
            ).fetchone()
            if new_dom is None:
                raise HTTPException(
                    status_code=422, detail=f"Unknown domain id {new_domain_id}"
                )
            if new_dom["team_id"] != artifact_row["team_id"]:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"domain {new_domain_id} belongs to team "
                        f"{new_dom['team_id']}, not the artifact's team "
                        f"{artifact_row['team_id']}"
                    ),
                )

        # tags: list[str] in the model, JSON text in the column.
        if "tags" in changes:
            changes["tags"] = json.dumps(changes["tags"])

        _patch_update(conn, "artifact", id, changes)
        conn.commit()
        row = conn.execute("SELECT * FROM artifact WHERE id = ?", (id,)).fetchone()
        return _artifact(row)
    finally:
        conn.close()
