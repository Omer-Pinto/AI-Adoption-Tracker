"""Pydantic models — the validation + form + LLM-draft contract.

Two groups:

1. Entity models — mirror the §5 storage tables (the fanned-out current-state
   and history rows). Used for API request/response shapes by Wave-1.

2. Report-document models — mirror the §4 weekly-report JSON. This same shape
   serves three jobs: the form layout, the save-time validation, and the
   contract the LLM drafts against. `report_schema.json` is the JSON-Schema
   twin of these models.

Design notes (see uncertainties in the agent report):
  * ids are int (SQLite INTEGER PK).
  * dates are kept as ISO strings (`str`) end-to-end — the spec uses plain
    "YYYY-MM-DD" text and SQLite has no date type; we don't coerce to
    `datetime.date` to keep the LLM-draft round-trip lossless.
  * `tags` is a list[str] in the model; persisted as JSON text in `artifact`.
  * Tasks and artifacts are referenced by NAME only. Whether a name is new or
    already exists is resolved at fan-out time against the DB (existing → reuse;
    unknown → create). There is no new_task / new_artifact discriminator.
"""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1


# ── enums ─────────────────────────────────────────────────────────────────

class TaskStatus(str, Enum):
    planned = "planned"
    in_progress = "in-progress"
    finished_successfully = "finished_successfully"
    finished_with_issues = "finished_with_issues"
    blocked = "blocked"
    abandoned = "abandoned"


class ArtifactType(str, Enum):
    agent = "agent"
    skill = "skill"
    hook = "hook"
    context = "context"


class ArtifactChangeKind(str, Enum):
    added = "added"
    updated = "updated"
    retired = "retired"
    moved = "moved"


# ── entity models (§5 tables) ───────────────────────────────────────────────

class Team(BaseModel):
    id: int
    name: str
    cc_baseline: str | None = None
    baseline_date: str | None = None


class Champion(BaseModel):
    id: int
    name: str
    team_id: int
    start_date: str | None = None
    end_date: str | None = None


class DomainRef(BaseModel):
    """Lightweight reference to a linked domain (used inside Domain.cross_domains)."""
    id: int
    name: str
    team_id: int
    team_name: str


class Domain(BaseModel):
    id: int
    team_id: int
    team_name: str
    champion_id: int
    name: str
    description: str | None = None
    priority: str | None = None
    cross_domains: list[DomainRef] = Field(default_factory=list)


class Report(BaseModel):
    id: int
    champion_id: int
    meeting_date: str
    report_json: str
    schema_version: int


class Task(BaseModel):
    id: int
    domain_id: int
    name: str
    status: TaskStatus
    owner: str | None = None
    started_on: str | None = None
    ended_on: str | None = None


class TaskHistory(BaseModel):
    id: int
    task_id: int
    report_id: int
    meeting_date: str
    status_at_meeting: TaskStatus
    change_note: str | None = None


class Artifact(BaseModel):
    id: int
    team_id: int
    domain_id: int | None = None
    name: str
    type: ArtifactType
    tags: list[str] = Field(default_factory=list)
    summary: str | None = None


class ArtifactHistory(BaseModel):
    id: int
    artifact_id: int
    report_id: int
    meeting_date: str
    change_kind: ArtifactChangeKind
    change_note: str | None = None


class ActionItem(BaseModel):
    id: int
    report_id: int
    domain_id: int | None = None
    text: str
    owner: str | None = None
    due_date: str | None = None
    resolved: bool = False


# ── report-document models (§4 JSON) ─────────────────────────────────────────
# Tasks and artifacts are identified by name only. Resolution (existing vs new)
# happens at fan-out time in the engine, not in the report document.
# `populate_by_name=True` lets callers build models with either alias or Python
# attribute name.

_doc_config = ConfigDict(populate_by_name=True)


class ReportTaskEntry(BaseModel):
    """A task line inside a report domain.

    ``task`` is the task's name. The engine resolves it against the DB: if a
    task with that name exists in the domain, its row is updated; if not, a new
    task row is created. There is no separate ``new_task`` field.

    ``finished_on`` is an optional per-task finish-date override (YYYY-MM-DD).
    When the task reaches a terminal status, ``ended_on`` is set to this value
    if present, otherwise to the report's ``meeting_date``.  The engine NEVER
    auto-computes a finish date from status history (spec §5, Omer's rule).
    """
    model_config = _doc_config

    task: str
    status: TaskStatus
    owner: str | None = None
    note: str | None = None
    finished_on: str | None = None


class ReportArtifactEntry(BaseModel):
    """An artifact change line inside a report domain.

    ``artifact`` is the artifact's name. The engine resolves it against the DB:
    if an artifact with that name exists in the team's scope, its row is
    updated; if not, a new artifact row is created (``type`` is required in
    that case). There is no separate ``new_artifact`` field.

    ``change_kind`` defaults to "added" when the artifact is newly created and
    to "updated"/"moved" when it already exists; the field may be supplied
    explicitly to override inference.
    """
    model_config = _doc_config

    artifact: str
    type: ArtifactType | None = None
    tags: list[str] | None = None
    change_kind: ArtifactChangeKind | None = None
    note: str | None = None


class ReportDomainChanges(BaseModel):
    """Only the domain fields that changed this meeting; omit if none (§4)."""
    model_config = _doc_config

    description: str | None = None
    priority: str | None = None


class ReportDomainSection(BaseModel):
    """One domain's slice of a weekly report."""
    model_config = _doc_config

    domain: str
    changes: ReportDomainChanges | None = None
    tasks: list[ReportTaskEntry] = Field(default_factory=list)
    artifacts: list[ReportArtifactEntry] = Field(default_factory=list)


class ReportActionItem(BaseModel):
    """An action item inside a report (§4: text, owner; optional domain/due)."""
    model_config = _doc_config

    text: str
    owner: str | None = None
    domain: str | None = None
    due_date: str | None = None


class ReportDocument(BaseModel):
    """The full §4 weekly-report JSON. Drives the form, save validation, and the
    LLM drafting contract."""
    model_config = _doc_config

    champion: str
    meeting_date: str
    participants: list[str] = Field(default_factory=list)
    raw_notes: str
    domains: list[ReportDomainSection] = Field(default_factory=list)
    # Team-wide artifacts not tied to any tech-stack domain (e.g. cross-cutting
    # Claude Code adoption: context packs, team-wide skills). Saved with
    # domain_id NULL → shown in the team's all-team gutter. "Claude Code" is
    # never a domain; such artifacts live here instead.
    artifacts: list[ReportArtifactEntry] = Field(default_factory=list)
    action_items: list[ReportActionItem] = Field(default_factory=list)
    discussion: str | None = None
    issues: str | None = None
