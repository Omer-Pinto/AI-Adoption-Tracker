"""Pydantic models — the validation + form + LLM-draft contract.

Two groups:

1. Entity models — mirror the §5 storage tables (the fanned-out current-state
   and history rows). Used for API request/response shapes by Wave-1.

2. Report-document models — mirror the §4 weekly-report JSON. This same shape
   serves three jobs: the form layout, the save-time validation, and the
   contract the LLM drafts against. These Pydantic models are the SOLE source
   of truth for that contract (the OpenAI/Anthropic structured-output schema is
   derived from `ReportDocument` at call time; there is no JSON-Schema twin).

Design notes (see uncertainties in the agent report):
  * ids are int (SQLite INTEGER PK).
  * dates are kept as ISO strings (`str`) end-to-end — the spec uses plain
    "YYYY-MM-DD" text and SQLite has no date type; we don't coerce to
    `datetime.date` to keep the LLM-draft round-trip lossless.
  * `tags` is a list[str] in the model; persisted as JSON text in `artifact`.
  * Tasks and artifacts link to existing rows by an optional ``id`` (the matched
    record's integer PK); ``name`` is the human-readable label. No ``id`` means a
    new task/artifact to create at fan-out time.
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
    wont_fix = "wont_fix"


# Terminal / "closed" status tokens (FROZEN CONTRACT, Wave 12), shared by the
# team-page open/closed tallies. A task or action item is OPEN when its status is
# NOT in this set (planned, in-progress, blocked). ``due_date`` is a free user
# date and is no longer gated by these.
TERMINAL_STATUSES = frozenset(
    {"finished_successfully", "finished_with_issues", "abandoned", "wont_fix"}
)


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
    due_date: str | None = None


class TaskHistory(BaseModel):
    """One journal row for a task at one meeting (report or manual edit).

    Self-sufficient: `owner` and `due_date` carry whatever the recompute needs,
    so current-state is derived from these columns alone (never report_json).
    `report_id` is None for a manual (`source='manual'`) entry.
    """
    id: int
    task_id: int
    report_id: int | None = None
    meeting_date: str
    status_at_meeting: TaskStatus
    owner: str | None = None
    due_date: str | None = None
    change_note: str | None = None
    source: str = "report"


class Artifact(BaseModel):
    id: int
    team_id: int
    domain_id: int | None = None
    name: str
    type: ArtifactType
    tags: list[str] = Field(default_factory=list)
    summary: str | None = None


class ArtifactHistory(BaseModel):
    """One artifact change event (report or manual edit).

    `report_id` is None for a manual (`source='manual'`) entry.
    """
    id: int
    artifact_id: int
    report_id: int | None = None
    meeting_date: str
    change_kind: ArtifactChangeKind
    change_note: str | None = None
    source: str = "report"


class ActionItem(BaseModel):
    id: int
    report_id: int
    domain_id: int | None = None
    text: str
    owner: str | None = None
    due_date: str | None = None
    status: TaskStatus = TaskStatus.planned


# ── report-document models (§4 JSON) ─────────────────────────────────────────
# The report is FLAT: tasks and artifacts are top-level lists, each entry carrying
# its own domain placement. There is no nested domain tree.
#
# TWO INDEPENDENT id-match conventions, with OPPOSITE null semantics:
#   * Entity id (`id` on task/artifact entries): the matched existing row's PK.
#     ``id = None`` MEANS "create a NEW task/artifact" at fan-out time.
#   * Domain id (`domain_id` on every entry / action item): the matched existing
#     domain's PK, with ``domain`` carrying that domain's exact name.
#     ``domain_id = None`` does NOT create a domain — it means UNPLACED / team-wide
#     (the per-champion "General" gutter). The report NEVER mints domains; a human
#     reassigns null-domain items via the UI picker.
#
# `populate_by_name=True` lets callers build models with either alias or Python
# attribute name; `extra="forbid"` rejects any unknown key on every report
# sub-model (it only bars unknown keys — content mapped to known fields is kept).

_doc_config = ConfigDict(populate_by_name=True, extra="forbid")


class ReportTaskEntry(BaseModel):
    """A flat task line in a report (domain carried per entry).

    ``task`` is the task's human-readable name.

    ``due_date`` is an optional per-task target date (YYYY-MM-DD). It is a FREE
    user-picked date — like an action item's due date — settable on ANY task
    (including a brand-new one) regardless of status; current-state ``due_date``
    is just the latest journal row's value, never auto-computed from status.

    ``note`` is the per-meeting change note (-> ``task_history.change_note``).

    ENTITY id-match — ``id`` is the link signal. The draft context feeds this
    team's existing tasks each with their integer PK. A note line that matches an
    existing task → set ``id`` to that PK and ``task`` to the EXACT existing name
    (links to the real row). A new task (no match, or the notes say "new …") →
    omit ``id`` (null) and give the free-text name; ``status`` is required.

    DOMAIN id-match — ``domain_id`` is the matched EXISTING domain's PK and
    ``domain`` its exact name. ``domain_id = None`` does NOT create a domain: it
    marks the task as unplaced/team-wide ("General" bucket), reassigned via the
    UI picker. The report never invents domains.
    """
    model_config = _doc_config

    id: int | None = None
    task: str
    status: TaskStatus
    owner: str | None = None
    note: str | None = None
    due_date: str | None = None
    domain_id: int | None = None
    domain: str | None = None


class ReportArtifactEntry(BaseModel):
    """A flat artifact change line in a report (domain carried per entry).

    ``artifact`` is the artifact's human-readable name.

    ``summary`` is the artifact's standing description (-> entity
    ``Artifact.summary``); ``note`` is the per-meeting change note
    (-> ``artifact_history.change_note``). They are DISTINCT fields.

    ``change_kind`` is "added" for a newly created artifact and
    "updated"/"moved"/"retired" for an existing one; it may be supplied
    explicitly to override inference.

    ENTITY id-match — ``id`` is the link signal. The draft context feeds this
    team's existing artifacts each with their integer PK. A note line that
    matches an existing artifact → set ``id`` to that PK, ``artifact`` to the
    EXACT existing name, and copy the entity's existing ``type``. A new artifact
    (no match, or the notes say "new …") → omit ``id`` (null), give the free-text
    name, and set a best-fit ``type`` (required for a NEW artifact).

    DOMAIN id-match — ``domain_id`` is the matched EXISTING domain's PK and
    ``domain`` its exact name. ``domain_id = None`` does NOT create a domain: it
    marks the artifact as team-wide / cross-cutting (the all-team gutter; e.g.
    shared context packs, team-wide skills), reassigned via the UI picker. The
    report never invents domains.
    """
    model_config = _doc_config

    id: int | None = None
    artifact: str
    type: ArtifactType | None = None
    tags: list[str] | None = None
    summary: str | None = None
    change_kind: ArtifactChangeKind | None = None
    note: str | None = None
    domain_id: int | None = None
    domain: str | None = None


class ReportActionItem(BaseModel):
    """An action item in a report (§4: text, owner; optional domain/due).

    DOMAIN id-match — ``domain_id`` is the matched EXISTING domain's PK and
    ``domain`` its exact name (replacing the old free-text ``domain`` string).
    ``domain_id = None`` does NOT create a domain: it means unplaced/team-wide,
    reassigned via the UI picker. The report never invents domains.
    """
    model_config = _doc_config

    text: str
    owner: str | None = None
    due_date: str | None = None
    status: TaskStatus = TaskStatus.planned
    domain_id: int | None = None
    domain: str | None = None


class ReportDocument(BaseModel):
    """The full §4 weekly-report JSON. Drives the form, save validation, and the
    LLM drafting contract.

    FLAT shape: ``tasks`` and ``artifacts`` are top-level lists, each entry
    carrying its own ``domain_id``/``domain`` placement — there is no nested
    domain tree. An artifact with ``domain_id = None`` is the team-wide /
    cross-cutting case (formerly the separate top-level ``artifacts`` concept).
    """
    model_config = _doc_config

    champion: str
    meeting_date: str
    participants: list[str] = Field(default_factory=list)
    raw_notes: str
    tasks: list[ReportTaskEntry] = Field(default_factory=list)
    artifacts: list[ReportArtifactEntry] = Field(default_factory=list)
    action_items: list[ReportActionItem] = Field(default_factory=list)
    # `discussion` / `issues` are ordered LISTS of free-text items (each entry one
    # discussion point / one issue; an item may itself contain multiple lines).
    # They live only inside report_json — not fanned out to any table.
    discussion: list[str] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
