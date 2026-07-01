"""Views & lists API — team/domain pages, task & artifact lists/details.

Wave-1 Agent 1B. Implements API contract §2 (Views & lists). Read-only
endpoints over the §5 storage tables: the landing index, the team page (the
team's portfolio of domains), the domain page, and the task/artifact list +
detail endpoints.

The two list endpoints (`/tasks`, `/artifacts`) accept the optional `q` DSL and
delegate filtering to Agent 1D's `search` package via the
`filter_tasks` / `filter_artifacts` / `ParseError` seam — this module never
implements the DSL itself. All other endpoints are self-contained here.

`{id}` on the team page is the TEAM id (Wave 16): a team owns exactly one
champion (`team.champion_name`), so the page keys directly by team. Everything
on it (domains, reports, action items) hangs off `team_id`.
"""

from __future__ import annotations

import json
import sqlite3

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, field_validator

from models import ArtifactType, TaskStatus, TERMINAL_STATUSES

import models
from db import get_connection
from domain_helpers import build_domain
from reports import (
    EngineError,
    apply_manual_artifact_edit,
    apply_manual_task_edit,
)

# Cross-agent seam (Agent 1D's `search` package). 1D adapts the vendored DSL
# engine to expose these helpers; until then this import resolves against the
# package but the names may be absent in an isolated worktree (verified at
# merge). See agent report.
from search import ParseError, filter_artifacts, filter_tasks

router = APIRouter(prefix="/api", tags=["views"])


# ── local composite response models (not in models.py) ──────────────────────
# Field names match the contract §2 shapes EXACTLY.

class TeamPageIndexEntry(BaseModel):
    """One landing-index entry per team (contract §2; Wave 16: one champion/team).

    `champion_name` is the team's single champion (`team.champion_name`).
    """
    team_id: int
    team_name: str
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
    """The hub: a team's portfolio of domains (contract §2).

    Wave 16: the team owns its single champion, so the champion is surfaced via
    `team.champion_name` — there is no longer an embedded `champion` entity.

    The `*_count` / open-closed fields are summary tallies over the data already
    loaded for the page (Wave 12). "Closed" uses the terminal status set; "open"
    is everything else.
    """
    team: models.Team
    domains: list[DomainBlock]
    all_team_artifacts: list[models.Artifact]
    reports: list[models.Report]
    open_tasks: int
    closed_tasks: int
    meeting_count: int
    domain_count: int
    artifact_count: int


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
    `started_on`, `due_date` are all editable (partial PATCH).

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
    due_date: str | None = None


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


def _require_non_blank_text(v: str) -> str:
    """Strip `text` and reject a blank/whitespace-only value (422)."""
    v = v.strip()
    if not v:
        raise ValueError("text must not be blank")
    return v


class ActionItemCreate(BaseModel):
    """Create a STANDALONE AI-Lead action item (A1+A2).

    An action item is EXCLUSIVELY the AI Lead's own to-do, so there is NO owner.
    The server applies report_id=NULL; the caller supplies text/status/due_date/
    note and an optional ``domain_id`` (a standalone item may be placed in a
    domain). A blank/whitespace-only text is rejected (422); text is stored
    stripped.
    """
    text: str
    status: TaskStatus = TaskStatus.planned
    due_date: str | None = None
    note: str | None = None
    domain_id: int | None = None

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, v: str) -> str:
        return _require_non_blank_text(v)


class ActionItemPatch(BaseModel):
    """In-place edit for ANY action item (A1+A2 full CRUD).

    Every field is editable on EVERY item (report-derived and standalone alike):
    ``text``, ``status``, ``due_date``, ``note`` and ``domain_id``. An omitted
    field is untouched; an explicit ``null`` clears a nullable field
    (``model_dump(exclude_unset=True)``).
    """
    text: str | None = None
    status: TaskStatus | None = None
    due_date: str | None = None
    note: str | None = None
    domain_id: int | None = None

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, v: str | None) -> str | None:
        # Only validates when supplied; an omitted text leaves it unset.
        return v if v is None else _require_non_blank_text(v)


class AILeadActionItem(BaseModel):
    """One AI-Lead action item, flattened across ALL teams (A1+A2).

    The AI-Lead worklist: EVERY action item (all are the AI Lead's — there is no
    owner), resolved against its report/champion/team and (optional) domain.
    `domain` is null when the item is unplaced/team-wide. `note` is the item's
    free-text annotation.

    Two flavours: a report-derived item has team/champion/meeting_date/report_id
    all set; a standalone (self-managed) item has them all null.
    """
    id: int
    text: str
    team_name: str | None = None
    champion_name: str | None = None
    meeting_date: str | None = None
    status: str
    due_date: str | None = None
    note: str | None = None
    domain: str | None = None
    report_id: int | None = None


# `from __future__ import annotations` makes the model field annotations strings;
# rebuild so pydantic resolves the `models.*` forward references at import time.
for _m in (DomainBlock, TeamPage, DomainPage, TaskDetail, ArtifactDetail):
    _m.model_rebuild()


# ── row → model mappers ──────────────────────────────────────────────────────

def _team(row: sqlite3.Row) -> models.Team:
    return models.Team(**dict(row))


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
    # A1+A2: no owner; the row carries `note` (free-text), `domain_id`, `status`
    # (plain TEXT), text, due_date — all map straight onto ActionItem.
    return models.ActionItem(**dict(row))


# ── Wave-10 helpers ──────────────────────────────────────────────────────────

def _domain_name(conn: sqlite3.Connection, domain_id: int | None) -> str | None:
    """Resolve a domain's name; None for a null/unknown domain_id."""
    if domain_id is None:
        return None
    row = conn.execute(
        "SELECT name FROM domain WHERE id = ?", (domain_id,)
    ).fetchone()
    return row["name"] if row is not None else None


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
    """Landing index: one entry per team (contract §2; Wave 16).

    One row per team (a team owns exactly one champion). `champion_name` is the
    team's champion; `domain_count` counts the team's domains (domain.team_id).
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT
                t.id            AS team_id,
                t.name          AS team_name,
                t.champion_name AS champion_name,
                (SELECT COUNT(*) FROM domain d WHERE d.team_id = t.id)
                    AS domain_count
            FROM team t
            ORDER BY t.name, t.id
            """
        ).fetchall()
        return [TeamPageIndexEntry(**dict(r)) for r in rows]
    finally:
        conn.close()


@router.get("/teams/{id}/page", response_model=TeamPage)
def team_page(id: int) -> TeamPage:
    """The hub for one team's portfolio. `{id}` is the TEAM id (Wave 16).

    Returns each domain with current tasks/artifacts plus full history, the
    all-team gutter (team artifacts with domain_id NULL), and the team's reports
    (newest first). The champion is surfaced via `team.champion_name`. Action
    items are NOT surfaced here — they live only on the AI-Lead board
    (`GET /api/ai-lead/action-items`).
    """
    conn = get_connection()
    try:
        team_row = conn.execute(
            "SELECT * FROM team WHERE id = ?", (id,)
        ).fetchone()
        if team_row is None:
            raise HTTPException(status_code=404, detail="Team not found")
        team = _team(team_row)

        domain_id_rows = conn.execute(
            "SELECT id FROM domain WHERE team_id = ? ORDER BY priority IS NULL, priority, id",
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

        # All-team gutter: this team's artifacts with no domain.
        gutter_rows = conn.execute(
            "SELECT * FROM artifact WHERE team_id = ? AND domain_id IS NULL ORDER BY id",
            (team.id,),
        ).fetchall()
        all_team_artifacts = [_artifact(r) for r in gutter_rows]

        report_rows = conn.execute(
            "SELECT * FROM report WHERE team_id = ? ORDER BY meeting_date DESC, id DESC",
            (id,),
        ).fetchall()
        reports = [_report(r) for r in report_rows]

        # ── summary tallies over the data already loaded above (Wave 12) ──────
        # Closed = status in the terminal set; open = everything else.
        open_tasks = closed_tasks = 0
        artifact_count = len(all_team_artifacts)
        for block in domains:
            artifact_count += len(block.artifacts)
            for t in block.tasks:
                if t.status.value in TERMINAL_STATUSES:
                    closed_tasks += 1
                else:
                    open_tasks += 1

        return TeamPage(
            team=team,
            domains=domains,
            all_team_artifacts=all_team_artifacts,
            reports=reports,
            open_tasks=open_tasks,
            closed_tasks=closed_tasks,
            meeting_count=len(reports),
            domain_count=len(domains),
            artifact_count=artifact_count,
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
    """Manager edit for a task's current state — JOURNALED (source='manual').

    This is a management tool: the manager edits current-state directly. Accepts
    `status` (validated against `TaskStatus`), `owner`, `domain_id`, `started_on`,
    `due_date` (partial PATCH). The edit is BOTH saved to current-state AND
    journaled: the engine appends one `source='manual'` `task_history` row dated
    today so the weekly story does not silently contradict the current state.

    SOLID: the route only validates (404 / cross-team 422 / status enum — already
    enforced by Pydantic) and delegates; the engine owns the state+journal write
    in one transaction.

    A non-null `domain_id` must exist (else 422) and its team must equal the task's
    current team (via current domain) else 422 cross-team. 404 if the task is
    missing.
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
        # An explicit `null` status is invalid (the column is NOT NULL) → 422,
        # not a DB IntegrityError 500.
        if "status" in changes:
            if changes["status"] is None:
                raise HTTPException(status_code=422, detail="status cannot be null")
            changes["status"] = changes["status"].value

        # owner may be edited freely; null owner clears the owner.

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

        # Delegate the state update + manual journal row to the engine.
        try:
            row = apply_manual_task_edit(conn, id, changes)
        except EngineError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _task(row)
    finally:
        conn.close()


@router.patch("/artifacts/{id}", response_model=models.Artifact)
def patch_artifact(id: int, body: ArtifactPatch) -> models.Artifact:
    """Entity-page edit for an artifact — JOURNALED (source='manual').

    Accepts `name`, `type`, `tags`, `summary`, `domain_id` (partial). `type` is
    validated by the `ArtifactType` enum. `tags` is re-serialized to JSON text on
    write. A non-null `domain_id` must exist and its team must equal the
    artifact's team else 422; null is allowed (team-wide). 404 if missing.

    The edit is BOTH saved to current-state AND journaled: the engine appends one
    `source='manual'` `artifact_history` row dated today (`change_kind` = 'moved'
    if the domain changed else 'updated'). SOLID: the route validates + delegates;
    the engine owns the state+journal write in one transaction.
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

        # Delegate the state update + manual journal row to the engine.
        try:
            row = apply_manual_artifact_edit(conn, id, changes)
        except EngineError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _artifact(row)
    finally:
        conn.close()


@router.post(
    "/action-items",
    response_model=AILeadActionItem,
    status_code=status.HTTP_201_CREATED,
)
def create_action_item(body: ActionItemCreate) -> AILeadActionItem:
    """Create a STANDALONE AI-Lead action item (A1+A2).

    An action item is EXCLUSIVELY the AI Lead's own to-do, so there is NO owner.
    Server-applied: report_id=NULL. The caller may place it in a domain
    (`domain_id`, else NULL = unplaced/team-wide) and supply a `note`. Text is
    stored stripped (validator already rejected blank as 422). Returns the
    enriched `AILeadActionItem` (201) for the new row — a standalone row has
    team_name/champion_name/meeting_date/report_id all null; `domain` is resolved
    from the supplied `domain_id`.
    """
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO action_item (report_id, domain_id, text, note, due_date, status) "
            "VALUES (NULL, ?, ?, ?, ?, ?)",
            (body.domain_id, body.text, body.note, body.due_date, body.status.value),
        )
        conn.commit()
        return AILeadActionItem(
            id=cur.lastrowid,
            text=body.text,
            team_name=None,
            champion_name=None,
            meeting_date=None,
            status=body.status.value,
            due_date=body.due_date,
            note=body.note,
            domain=_domain_name(conn, body.domain_id),
            report_id=None,
        )
    finally:
        conn.close()


@router.delete("/action-items/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_action_item(id: int) -> None:
    """Delete ANY AI-Lead action item (A1+A2 full CRUD).

    Delete is allowed for every action item — report-derived and standalone
    alike (all are the AI Lead's independent to-dos). Precedence: missing → 404;
    else delete → 204.
    """
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM action_item WHERE id = ?", (id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Action item not found")
        conn.execute("DELETE FROM action_item WHERE id = ?", (id,))
        conn.commit()
    finally:
        conn.close()


@router.patch("/action-items/{id}", response_model=models.ActionItem)
def patch_action_item(id: int, body: ActionItemPatch) -> models.ActionItem:
    """In-place edit for ANY action item's current state — UN-JOURNALED (A1+A2).

    Full in-place CRUD: EVERY field is editable on EVERY item (report-derived and
    standalone alike). Accepts `text`, `status` (validated against `TaskStatus`),
    `due_date`, `note` and `domain_id` (partial PATCH). Action items are
    create-once and are NOT touched by report replay/edit, so an edit here is
    durable (no journal, no re-fold).

    Precedence: blank text → 422 (validator); row missing → 404; null status →
    422 (the column is NOT NULL).

    An explicit `null` clears a nullable field; an omitted field is untouched
    (`model_dump(exclude_unset=True)`).
    """
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM action_item WHERE id = ?", (id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Action item not found")

        changes = body.model_dump(exclude_unset=True)

        # `status` arrives as a TaskStatus enum (Pydantic already rejected an
        # invalid value as 422); persist its string value in the TEXT column.
        # An explicit `null` status is invalid (the column is NOT NULL) → 422,
        # not a DB IntegrityError 500.
        if "status" in changes:
            if changes["status"] is None:
                raise HTTPException(status_code=422, detail="status cannot be null")
            changes["status"] = changes["status"].value

        if changes:
            cols = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(
                f"UPDATE action_item SET {cols} WHERE id = ?",
                (*changes.values(), id),
            )
            conn.commit()

        updated = conn.execute(
            "SELECT * FROM action_item WHERE id = ?", (id,)
        ).fetchone()
        return _action_item(updated)
    finally:
        conn.close()


# ── Wave-12: cross-team AI-Lead worklist ─────────────────────────────────────

@router.get("/ai-lead/action-items", response_model=list[AILeadActionItem])
def ai_lead_action_items() -> list[AILeadActionItem]:
    """EVERY action item — report-derived AND standalone (A1+A2).

    All action items are the AI Lead's (there is no owner), so the worklist
    returns every row. LEFT-JOINs each `action_item` against its report
    (meeting_date, report_id) and team (name + champion_name); a standalone item
    (report_id NULL) leaves those null. `champion_name` is the team's single
    champion (`team.champion_name`). `note` is the item's free-text annotation.
    `domain` is resolved via the nullable `action_item.domain_id` (null =
    unplaced/team-wide). Ordered with standalone/NULL-meeting-date items first,
    then meeting items newest-first (meeting_date DESC, id DESC for same-date
    ties)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT
                ai.id             AS id,
                ai.text           AS text,
                t.name            AS team_name,
                t.champion_name   AS champion_name,
                r.meeting_date    AS meeting_date,
                ai.status         AS status,
                ai.due_date       AS due_date,
                ai.note           AS note,
                d.name            AS domain,
                r.id              AS report_id
            FROM action_item ai
            LEFT JOIN report r ON r.id = ai.report_id
            LEFT JOIN team t   ON t.id = r.team_id
            LEFT JOIN domain d ON d.id = ai.domain_id
            ORDER BY (r.meeting_date IS NULL) DESC, r.meeting_date DESC, ai.id DESC
            """
        ).fetchall()
        return [AILeadActionItem(**dict(r)) for r in rows]
    finally:
        conn.close()


# ── AI-Lead personal toolkit (standalone `ai_lead_item` CRUD) ────────────────
# Meta-skills + Claude Code enhancements the AI Lead maintains. STANDALONE: no
# team/domain/report coupling, no history. Plain parameterized SQL via
# `get_connection()`, one connection per request (try/finally:close).

def _ai_lead_item(row: sqlite3.Row) -> models.AILeadItem:
    """Map an `ai_lead_item` row to its response model."""
    return models.AILeadItem(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        category=row["category"],
    )


@router.get("/ai-lead/items", response_model=list[models.AILeadItem])
def ai_lead_items() -> list[models.AILeadItem]:
    """Every AI-Lead toolkit item, grouped by category then case-folded name."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM ai_lead_item ORDER BY category, LOWER(name), id"
        ).fetchall()
        return [_ai_lead_item(r) for r in rows]
    finally:
        conn.close()


@router.post(
    "/ai-lead/items",
    response_model=models.AILeadItem,
    status_code=status.HTTP_201_CREATED,
)
def create_ai_lead_item(body: models.AILeadItemCreate) -> models.AILeadItem:
    """Create a toolkit item. A blank/whitespace-only name is rejected (422);
    the stored name is stripped. `category` is persisted as its string value."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")

    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO ai_lead_item (name, description, category) "
            "VALUES (?, ?, ?)",
            (name, body.description, body.category.value),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM ai_lead_item WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
        return _ai_lead_item(row)
    finally:
        conn.close()


@router.patch("/ai-lead/items/{id}", response_model=models.AILeadItem)
def patch_ai_lead_item(id: int, body: models.AILeadItemPatch) -> models.AILeadItem:
    """Partial-PATCH a toolkit item (same pattern as `patch_action_item`).

    Only provided fields are written (`model_dump(exclude_unset=True)`); an
    explicit `null` clears a nullable field. `category` is persisted as its
    string value. If a `name` is supplied it must not be blank (422). 404 if
    the item is missing."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM ai_lead_item WHERE id = ?", (id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="AI-Lead item not found")

        changes = body.model_dump(exclude_unset=True)

        if "name" in changes:
            name = (changes["name"] or "").strip()
            if not name:
                raise HTTPException(status_code=422, detail="name must not be blank")
            changes["name"] = name

        # `category` arrives as the enum (Pydantic already rejected invalid as
        # 422); persist its string value in the TEXT column.
        if "category" in changes and changes["category"] is not None:
            changes["category"] = changes["category"].value

        if changes:
            cols = ", ".join(f"{k} = ?" for k in changes)
            conn.execute(
                f"UPDATE ai_lead_item SET {cols} WHERE id = ?",
                (*changes.values(), id),
            )
            conn.commit()

        updated = conn.execute(
            "SELECT * FROM ai_lead_item WHERE id = ?", (id,)
        ).fetchone()
        return _ai_lead_item(updated)
    finally:
        conn.close()


@router.delete(
    "/ai-lead/items/{id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_ai_lead_item(id: int) -> None:
    """Delete a toolkit item. 404 if missing."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM ai_lead_item WHERE id = ?", (id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="AI-Lead item not found")
        conn.execute("DELETE FROM ai_lead_item WHERE id = ?", (id,))
        conn.commit()
        return None
    finally:
        conn.close()
