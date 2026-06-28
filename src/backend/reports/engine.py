"""Report fan-out + replay engine (spec §5/§6).

Two write paths, each ONE SQLite transaction:

* ``fan_out_report`` — confirm/save a drafted ``ReportDocument``: insert the
  ``report`` row, then fan out the FLAT ``tasks``/``artifacts``/``action_items``
  lists to the current-state tables (``task``, ``artifact``) and the history
  tables (``task_history``, ``artifact_history``) plus ``action_item`` rows.
  Current-state is written directly (spec §5: "never rebuilt by replaying
  history").

* ``replay_report_edit`` — edit a saved report (spec §4 "Updating a saved
  report"): a TARGETED re-apply — delete ONLY this report's own journal rows
  (its ``report_id``; manual rows have a NULL ``report_id`` and survive), swap
  the stored ``report_json``, re-apply this report's entries as fresh
  ``source='report'`` rows (id back-filled, dup-safe), then recompute the
  touched tasks' current-state from the journal. No full-timeline re-fan-out.

* ``apply_manual_task_edit`` / ``apply_manual_artifact_edit`` — a direct
  current-state edit from the UI, journaled as a ``source='manual'`` row so the
  weekly story is not silently contradicted. The engine owns BOTH the entity
  update and the journal row in one transaction; the route just validates +
  delegates.

Read helpers: ``build_draft_context`` (state hints for the LLM) and
``get_report_row`` (one report, with ``report_json`` left as a JSON string).

Conventions match the rest of the backend: plain functions, parameterized SQL,
``sqlite3.Row`` access, dates as ISO "YYYY-MM-DD" strings.

Flat, id-based contract (Wave 9 Agent 9A)
-----------------------------------------
The report is FLAT: ``doc.tasks`` / ``doc.artifacts`` / ``doc.action_items`` are
top-level lists; each entry carries its OWN domain placement (``domain_id`` +
``domain``) and an optional entity ``id``.

* **Entity id-match** — ``entry.id`` is the matched existing row's PK. ``id is
  None`` MEANS "create a NEW task/artifact". On save we BACK-FILL the resolved
  PK onto the in-memory ``doc`` so the stored ``report_json`` is fully
  id-resolved; a later edit/replay is then purely id-based (no duplicates).

* **Domain id-match** — ``entry.domain_id`` / ``entry.domain`` name the EXISTING
  domain to place the entry in. The report NEVER mints a named domain. If a task
  resolves to no domain it falls back to the per-champion "General" catch-all (a
  task needs a domain); an artifact with no domain stays team-wide (``domain_id``
  NULL).

Replay no longer touches domain ``description``/``priority`` at all — those are
owned by the Smart-extract / management-CRUD flow, not by reports.

Design decisions (carried from Wave 2 Agent 2B):

* **First meeting = first report** — no pre-seed assumption. The first report
  creates tasks with ``change_kind = "added"`` and sets ``started_on`` to the
  first meeting date.

* **``started_on``** = date of the earliest history row.

* **``due_date``** — a STICKY FREE user-picked target date (like an action
  item's due date), stored per-journal-row on ``task_history.due_date``
  (``due_date`` on a report entry, or the supplied date on a manual edit). It is
  NOT gated by terminal status and is NEVER auto-computed:
  ``_recompute_task_current_state`` walks the journal newest → oldest and takes
  the latest NON-NULL ``due_date`` (manual clear authoritative) — exactly like
  ``owner`` — so a later report that omits ``due_date`` does NOT wipe a
  deliberately-set date. Purely from the journal, no report_json scrape.
"""

from __future__ import annotations

import datetime
import json
import sqlite3

from models import ReportArtifactEntry, ReportDocument, SCHEMA_VERSION

# ── exceptions ──────────────────────────────────────────────────────────────

class EngineError(RuntimeError):
    """A report could not be saved/edited for a domain reason (e.g. an unknown
    champion, a referenced entity id that does not belong to this team, or a new
    artifact with no type)."""


class ReportNotFoundError(EngineError):
    """No ``report`` row with the given id."""


# ── duplicate-date guard ─────────────────────────────────────────────────────

def _check_duplicate_date(
    conn: sqlite3.Connection,
    champion_id: int,
    meeting_date: str,
    exclude_report_id: int | None = None,
) -> None:
    """Raise EngineError if (champion_id, meeting_date) already exists.

    Pass ``exclude_report_id`` on edits so a report can keep its own date
    without triggering a false conflict.
    """
    if exclude_report_id is None:
        row = conn.execute(
            "SELECT id FROM report WHERE champion_id = ? AND meeting_date = ?",
            (champion_id, meeting_date),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT id FROM report "
            "WHERE champion_id = ? AND meeting_date = ? AND id != ?",
            (champion_id, meeting_date, exclude_report_id),
        ).fetchone()
    if row is not None:
        raise EngineError(
            f"A report for this champion on {meeting_date} already exists "
            f"(report id {row['id']}). Each champion can have at most one "
            "report per meeting date."
        )


# ── small helpers ─────────────────────────────────────────────────────────────

def _norm(name: str) -> str:
    """Normalise an entity name for matching: trimmed + casefolded.

    Case-insensitive, whitespace-insensitive matching of report entity names
    onto existing rows (decision — flagged as an uncertainty)."""
    return name.strip().casefold()


def _resolve_champion_id(conn: sqlite3.Connection, champion_name: str) -> int:
    row = conn.execute(
        "SELECT id, team_id FROM champion WHERE name = ?",
        (champion_name,),
    ).fetchone()
    if row is None:
        # Fall back to case-insensitive match before giving up.
        for cand in conn.execute("SELECT id, team_id, name FROM champion").fetchall():
            if _norm(cand["name"]) == _norm(champion_name):
                return cand["id"]
        raise EngineError(f"Unknown champion: {champion_name!r}")
    return row["id"]


def _champion_team_id(conn: sqlite3.Connection, champion_id: int) -> int:
    row = conn.execute(
        "SELECT team_id FROM champion WHERE id = ?", (champion_id,)
    ).fetchone()
    if row is None:
        raise EngineError(f"Unknown champion id: {champion_id}")
    return row["team_id"]


def _resolve_domain_id(
    conn: sqlite3.Connection, champion_id: int, domain_name: str
) -> int | None:
    """Match a domain NAME within THIS champion's domains; None if no match.

    Resolve-only: it NEVER creates a domain. The report does not mint domains."""
    target = _norm(domain_name)
    for row in conn.execute(
        "SELECT id, name FROM domain WHERE champion_id = ?", (champion_id,)
    ).fetchall():
        if _norm(row["name"]) == target:
            return row["id"]
    return None


_GENERAL_DOMAIN_NAME = "General"
_CONTEXT_DOMAIN_NAME = "Context creation"


def _ensure_constant_domain(
    conn: sqlite3.Connection,
    champion_id: int,
    team_id: int,
    name: str,
    description: str,
    priority: str | None,
) -> int:
    """Ensure a per-champion system-provided domain exists; return its id.

    Domains are tech/stack areas the user defines manually; this mints the small
    set of constant, always-present domains ('General', 'Context creation') the
    same way for every champion (idempotent by case-insensitive name)."""
    target = _norm(name)
    for row in conn.execute(
        "SELECT id, name FROM domain WHERE champion_id = ?", (champion_id,)
    ).fetchall():
        if _norm(row["name"]) == target:
            return row["id"]
    cur = conn.execute(
        "INSERT INTO domain (team_id, champion_id, name, description, priority) "
        "VALUES (?, ?, ?, ?, ?)",
        (team_id, champion_id, name, description, priority),
    )
    return cur.lastrowid


def _ensure_general_domain(conn: sqlite3.Connection, champion_id: int, team_id: int) -> int:
    """Ensure a per-champion 'General' catch-all domain exists; return its id.

    'General' is the system-provided FALLBACK bucket (priority NULL): the model
    parks tasks/artifacts it cannot confidently place here, and the user
    reassigns them to a real domain in the UI."""
    return _ensure_constant_domain(
        conn, champion_id, team_id, _GENERAL_DOMAIN_NAME,
        "Catch-all for items not yet assigned to a specific domain.", None,
    )


def _ensure_context_creation_domain(
    conn: sqlite3.Connection, champion_id: int, team_id: int
) -> int:
    """Ensure a per-champion 'Context creation' domain exists; return its id.

    A constant domain (priority '1') for context-engineering work — CLAUDE.md /
    context files, knowledge docs, conventions, and other Claude Code context the
    team builds. Unlike 'General' it PARTICIPATES in placement (the model may file
    items here) but is NOT the unplaced fallback."""
    return _ensure_constant_domain(
        conn, champion_id, team_id, _CONTEXT_DOMAIN_NAME,
        "Context engineering for Claude Code: CLAUDE.md, context files, "
        "knowledge docs, and conventions.", "1",
    )


def _champion_name(conn: sqlite3.Connection, champion_id: int) -> str:
    row = conn.execute(
        "SELECT name FROM champion WHERE id = ?", (champion_id,)
    ).fetchone()
    return row["name"]


def _resolve_entry_domain_id(
    conn: sqlite3.Connection,
    champion_id: int,
    team_id: int,
    domain_id: int | None,
    domain_name: str | None,
    *,
    needs_domain: bool,
) -> int | None:
    """Resolve a flat entry's domain to an EXISTING champion-domain id.

    Resolution order (NEVER mints a named domain):
      1. ``domain_id`` set AND it is one of this champion's domains → use it.
      2. else ``domain`` name matches one of this champion's domains → that id.
      3. else: for an entry that NEEDS a domain (a task) → the champion's
         'General' catch-all; for one that does not (an artifact / action item)
         → NULL (team-wide / unplaced)."""
    if domain_id is not None:
        row = conn.execute(
            "SELECT id FROM domain WHERE id = ? AND champion_id = ?",
            (domain_id, champion_id),
        ).fetchone()
        if row is not None:
            return row["id"]
    if domain_name:
        matched = _resolve_domain_id(conn, champion_id, domain_name)
        if matched is not None:
            return matched
    if needs_domain:
        return _ensure_general_domain(conn, champion_id, team_id)
    return None


def _domain_name_for_id(conn: sqlite3.Connection, domain_id: int | None) -> str | None:
    if domain_id is None:
        return None
    row = conn.execute("SELECT name FROM domain WHERE id = ?", (domain_id,)).fetchone()
    return row["name"] if row else None


# ── draft context (POST /draft) ────────────────────────────────────────────────

def build_draft_context(conn: sqlite3.Connection, champion_id: int) -> dict:
    """Build the existing-state hints handed to the LLM so it can id-match/de-dup.

    Team-scoped and id-bearing (Wave 9). The model matches a note mention to an
    existing entity by ``id`` and places it via ``domain_id``.

    Shape:
      * ``champion``: ``{id, name}``; ``champion_name`` mirrors the name (the
        draft prompt copies the champion from ``context["champion_name"]``).
      * ``team``: ``{id, name}``.
      * ``domains``: this champion's existing domains, each ``{id, name,
        description}`` — for placement (the 'General' catch-all is ensured).
      * ``tasks``: this team's existing tasks, each ``{id, name, status, owner,
        domain_id, domain}``.
      * ``artifacts``: this team's existing artifacts, each ``{id, name, type,
        tags, domain_id, domain}`` (``domain``/``domain_id`` null = team-wide)."""
    champ = conn.execute(
        "SELECT id, name, team_id FROM champion WHERE id = ?", (champion_id,)
    ).fetchone()
    if champ is None:
        raise EngineError(f"Unknown champion id: {champion_id}")
    team_id = champ["team_id"]
    team = conn.execute(
        "SELECT id, name FROM team WHERE id = ?", (team_id,)
    ).fetchone()

    # Guarantee the constant domains exist so both are offered to the model and
    # the UI domain picker: 'General' (the fallback bucket) and 'Context creation'
    # (a real placement target, priority 1).
    _ensure_general_domain(conn, champion_id, team_id)
    _ensure_context_creation_domain(conn, champion_id, team_id)
    conn.commit()

    # Map domain_id -> name for this champion's domains (used to label entities).
    domain_name_by_id: dict[int, str] = {}
    domains: list[dict] = []
    for dom in conn.execute(
        "SELECT id, name, description FROM domain WHERE champion_id = ? ORDER BY id",
        (champion_id,),
    ).fetchall():
        domain_name_by_id[dom["id"]] = dom["name"]
        domains.append(
            {"id": dom["id"], "name": dom["name"], "description": dom["description"]}
        )

    # Tasks: the team's existing tasks (a task lives in a domain, which belongs to
    # a champion of this team). Scope by the champion's domains.
    tasks: list[dict] = []
    for t in conn.execute(
        "SELECT t.id, t.name, t.status, t.owner, t.domain_id "
        "FROM task t JOIN domain d ON d.id = t.domain_id "
        "WHERE d.champion_id = ? ORDER BY t.id",
        (champion_id,),
    ).fetchall():
        tasks.append(
            {
                "id": t["id"],
                "name": t["name"],
                "status": t["status"],
                "owner": t["owner"],
                "domain_id": t["domain_id"],
                "domain": domain_name_by_id.get(t["domain_id"]),
            }
        )

    # Artifacts: the team's existing artifacts (domain may be null = team-wide).
    artifacts: list[dict] = []
    for a in conn.execute(
        "SELECT id, name, type, tags, domain_id FROM artifact "
        "WHERE team_id = ? ORDER BY id",
        (team_id,),
    ).fetchall():
        artifacts.append(
            {
                "id": a["id"],
                "name": a["name"],
                "type": a["type"],
                "tags": json.loads(a["tags"]) if a["tags"] else [],
                "domain_id": a["domain_id"],
                "domain": domain_name_by_id.get(a["domain_id"]) if a["domain_id"] else None,
            }
        )

    return {
        "champion": {"id": champ["id"], "name": champ["name"]},
        "champion_name": champ["name"],
        "team": {"id": team["id"], "name": team["name"]} if team else None,
        "domains": domains,
        "tasks": tasks,
        "artifacts": artifacts,
    }


# ── read one report ─────────────────────────────────────────────────────────────

def get_report_row(conn: sqlite3.Connection, report_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT id, champion_id, meeting_date, report_json, schema_version "
        "FROM report WHERE id = ?",
        (report_id,),
    ).fetchone()
    if row is None:
        raise ReportNotFoundError(f"No report with id {report_id}")
    return row


# ── fan-out (POST /api/reports) ─────────────────────────────────────────────────

def fan_out_report(conn: sqlite3.Connection, doc: ReportDocument) -> sqlite3.Row:
    """Save a confirmed draft: insert the report row and fan out all tables.

    Flat + id-based. As each entry is resolved/created, its resolved DB ids are
    BACK-FILLED onto the in-memory ``doc`` (entry ``id``/``domain_id``/``domain``);
    after processing, the report row's ``report_json`` is rewritten with the
    id-complete dump so a later edit/replay is purely id-based.

    Runs as ONE transaction."""
    with conn:  # one transaction; commits on success, rolls back on error
        champion_id = _resolve_champion_id(conn, doc.champion)
        team_id = _champion_team_id(conn, champion_id)

        _check_duplicate_date(conn, champion_id, doc.meeting_date)
        try:
            report_id = _insert_report_row(conn, champion_id, doc)
        except sqlite3.IntegrityError as exc:
            if "UNIQUE" in str(exc).upper():
                raise EngineError(
                    f"A report for this champion on {doc.meeting_date} already exists. "
                    "Each champion can have at most one report per meeting date."
                ) from exc
            raise

        for entry in doc.tasks:
            _apply_task_entry(conn, report_id, doc.meeting_date, champion_id, team_id, entry)

        for entry in doc.artifacts:
            _apply_artifact_entry(conn, report_id, doc.meeting_date, champion_id, team_id, entry)

        for item in doc.action_items:
            item_domain_id = _resolve_entry_domain_id(
                conn, champion_id, team_id, item.domain_id, item.domain, needs_domain=False
            )
            item.domain_id = item_domain_id
            item.domain = _domain_name_for_id(conn, item_domain_id)
            _insert_action_item(conn, report_id, champion_id, item_domain_id, item)

        # BACK-FILL: persist the id-complete document so replay is purely id-based.
        conn.execute(
            "UPDATE report SET report_json = ? WHERE id = ?",
            (doc.model_dump_json(by_alias=True, exclude_none=True), report_id),
        )

    return get_report_row(conn, report_id)


def _insert_report_row(
    conn: sqlite3.Connection, champion_id: int, doc: ReportDocument
) -> int:
    report_json = doc.model_dump_json(by_alias=True, exclude_none=True)
    cur = conn.execute(
        "INSERT INTO report (champion_id, meeting_date, report_json, schema_version) "
        "VALUES (?, ?, ?, ?)",
        (champion_id, doc.meeting_date, report_json, SCHEMA_VERSION),
    )
    return cur.lastrowid


def _record_task_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    champion_id: int,
    team_id: int,
    entry,
) -> tuple[int, bool]:
    """Resolve/create a task row, back-fill the entry, and append one history row.

    Shared by the save path (``_apply_task_entry``) and the report-edit re-apply
    (``replay_report_edit``) — they differ only in WHEN current-state is
    recomputed, so that is left to the caller. Does NOT recompute current-state.

    A task always needs a domain → falls back to 'General'. A MATCHED task
    (``entry.id`` set) is re-placed to its resolved domain so re-placement via the
    report works (decision: report placement is authoritative for an
    explicitly-referenced task). The resolved ids are back-filled onto the entry
    so a saved/re-applied report_json is id-complete (prevents duplicates on a
    later edit).

    Returns ``(task_id, created)`` where ``created`` is True when a brand-new
    task row was inserted (``entry.id`` was None)."""
    domain_id = _resolve_entry_domain_id(
        conn, champion_id, team_id, entry.domain_id, entry.domain, needs_domain=True
    )

    created = entry.id is None
    if entry.id is not None:
        task_id = _verify_task_in_team(conn, entry.id, champion_id)
        conn.execute(
            "UPDATE task SET domain_id = ? WHERE id = ?", (domain_id, task_id)
        )
        # A MATCHED task keeps its established owner: pass the report's owner
        # through as-is (NULL → the recompute walks back to the prior owner).
        # EXCEPTION: when NOTHING has ever set an owner on this task's journal —
        # e.g. a new task's own report being re-applied on edit, after its
        # create-time journal row was deleted — fall back to the champion default
        # so that champion-default owner is part of the REPLAYABLE history and
        # the recompute reconstructs it (instead of wiping owner to NULL). A
        # journal that already carries an owner decision is NOT re-defaulted (a
        # later silent report must not clobber a deliberately-set owner).
        owner = entry.owner
        if not owner and not _task_journal_has_owner(conn, task_id):
            owner = _champion_name(conn, champion_id)
    else:
        # A NEW task with no named owner defaults to the champion (the person
        # running the adoption), never NULL.
        owner = entry.owner or _champion_name(conn, champion_id)
        task_id = _create_task(conn, domain_id, entry.task, entry, owner)

    # Back-fill resolved ids onto the in-memory entry.
    entry.id = task_id
    entry.domain_id = domain_id
    entry.domain = _domain_name_for_id(conn, domain_id)

    conn.execute(
        "INSERT INTO task_history "
        "(task_id, report_id, meeting_date, status_at_meeting, owner, due_date, "
        " change_note, source) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'report')",
        (task_id, report_id, meeting_date, entry.status.value,
         owner, entry.due_date, entry.note),
    )
    return task_id, created


def _apply_task_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    champion_id: int,
    team_id: int,
    entry,
) -> None:
    """Save-path task fan-out: record the entry, then recompute current-state."""
    task_id, _ = _record_task_entry(
        conn, report_id, meeting_date, champion_id, team_id, entry
    )
    _recompute_task_current_state(conn, task_id)


def _verify_task_in_team(conn: sqlite3.Connection, task_id: int, champion_id: int) -> int:
    """Confirm a referenced task id exists and belongs to this champion's team."""
    row = conn.execute(
        "SELECT t.id FROM task t JOIN domain d ON d.id = t.domain_id "
        "WHERE t.id = ? AND d.champion_id = ?",
        (task_id, champion_id),
    ).fetchone()
    if row is None:
        raise EngineError(
            f"Report references task id {task_id} which does not exist for this champion."
        )
    return row["id"]


def _create_task(
    conn: sqlite3.Connection, domain_id: int, name: str, entry, owner: str | None
) -> int:
    cur = conn.execute(
        "INSERT INTO task (domain_id, name, status, owner) VALUES (?, ?, ?, ?)",
        (domain_id, name, entry.status.value, owner),
    )
    return cur.lastrowid


def _recompute_task_current_state(conn: sqlite3.Connection, task_id: int) -> None:
    """Set task.status/owner/started_on/due_date PURELY from the journal.

    The journal (``task_history``) is self-sufficient: every column the
    current-state needs is stored on the rows themselves, so report and manual
    entries are treated identically and ``report_json`` is never scraped.

    * ``started_on`` = meeting_date of the earliest history row (spec §4/§6).
    * ``status``     = the latest row's status.
    * ``owner``      = resolved by ``_latest_owner_from_journal`` (see below).
    * ``due_date``   = resolved by ``_latest_due_date_from_journal`` — a STICKY
      FREE user-picked date: the latest NON-NULL value (a later report that
      simply omits ``due_date`` does NOT wipe a deliberately-set date), with a
      manual clear authoritative. NOT gated by terminal status, never
      auto-computed.

    Ordering key is (meeting_date, id): ``id`` is monotonic with insertion, so a
    manual edit appended today sorts after a report on the same date, and within
    one fan-out the rows keep their applied order. (``report_id`` is no longer a
    valid tiebreak — manual rows have none.)"""
    rows = conn.execute(
        "SELECT meeting_date, status_at_meeting, owner, due_date, source "
        "FROM task_history WHERE task_id = ? "
        "ORDER BY meeting_date ASC, id ASC",
        (task_id,),
    ).fetchall()
    if not rows:
        return

    started_on = rows[0]["meeting_date"]
    latest_row = rows[-1]
    latest_status = latest_row["status_at_meeting"]

    due_date = _latest_due_date_from_journal(rows)

    owner = _latest_owner_from_journal(rows)

    conn.execute(
        "UPDATE task SET status = ?, owner = ?, started_on = ?, due_date = ? "
        "WHERE id = ?",
        (latest_status, owner, started_on, due_date, task_id),
    )


def _latest_owner_from_journal(rows: list) -> str | None:
    """Resolve the task owner from the journal (date,id-ordered ASC).

    Walk rows newest → oldest:

    * ``source='manual'`` row — its ``owner`` is AUTHORITATIVE even when NULL
      (an explicit clear). Stop immediately.
    * ``source='report'`` row with a non-NULL owner — use it, stop.
    * ``source='report'`` row with NULL owner — the report simply did not name
      an owner that meeting; keep walking.

    Returns ``None`` when no row has ever established an owner (the task row's
    existing owner is left untouched by the caller)."""
    for row in reversed(rows):
        if row["source"] == "manual":
            # Manual rows are always authoritative, including an explicit NULL clear.
            return row["owner"]
        # source == 'report'
        if row["owner"] is not None:
            return row["owner"]
    return None


def _latest_due_date_from_journal(rows: list) -> str | None:
    """Resolve the task ``due_date`` from the journal (date,id-ordered ASC).

    A STICKY free date — mirrors ``_latest_owner_from_journal``. Walk rows
    newest → oldest:

    * ``source='manual'`` row — its ``due_date`` is AUTHORITATIVE even when NULL
      (an explicit clear). Stop immediately.
    * ``source='report'`` row with a non-NULL ``due_date`` — use it, stop.
    * ``source='report'`` row with NULL ``due_date`` — the report simply did not
      name a date that meeting; keep walking (so a later silent report does NOT
      wipe a deliberately-set date).

    Returns ``None`` when no row has ever established a ``due_date``."""
    for row in reversed(rows):
        if row["source"] == "manual":
            # Manual rows are always authoritative, including an explicit NULL clear.
            return row["due_date"]
        # source == 'report'
        if row["due_date"] is not None:
            return row["due_date"]
    return None


def _task_journal_has_owner(conn: sqlite3.Connection, task_id: int) -> bool:
    """True if the task's journal already carries an owner DECISION.

    A decision is any ``source='manual'`` row (authoritative, including an
    explicit NULL clear) or any ``source='report'`` row with a non-NULL owner —
    exactly the rows ``_latest_owner_from_journal`` would stop on. Used to decide
    whether an empty-owner entry should fall back to the champion default: only
    when NOTHING has set an owner yet (a genuinely unowned/new task), so a later
    silent report never clobbers a deliberately-set (or deliberately-cleared)
    owner."""
    rows = conn.execute(
        "SELECT owner, source FROM task_history WHERE task_id = ?", (task_id,)
    ).fetchall()
    for row in rows:
        if row["source"] == "manual" or row["owner"] is not None:
            return True
    return False


def _apply_artifact_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    champion_id: int,
    team_id: int,
    entry: ReportArtifactEntry,
) -> None:
    """Resolve/create the current-state artifact row + append one history row.

    An artifact may be team-wide (resolved domain NULL). A MATCHED artifact
    (``entry.id`` set) is updated in place; a new one (``id`` None) is created and
    requires a ``type`` (→ 422 ``EngineError`` if missing). ``summary`` →
    ``artifact.summary`` and ``note`` → ``artifact_history.change_note`` are
    persisted SEPARATELY. Back-fills resolved ids onto the entry."""
    domain_id = _resolve_entry_domain_id(
        conn, champion_id, team_id, entry.domain_id, entry.domain, needs_domain=False
    )
    name = entry.artifact

    if entry.id is not None:
        artifact_id = _verify_artifact_in_team(conn, entry.id, team_id)
        change_kind = _infer_artifact_change_kind(conn, artifact_id, domain_id, entry)
        _update_artifact(conn, artifact_id, domain_id, entry)
    else:
        # `artifact.type` is NOT NULL in the DB; reject a missing type here as a
        # domain error (→ 422) rather than letting sqlite3.IntegrityError escape.
        if entry.type is None:
            raise EngineError(f"artifact {name!r} is new but has no type")
        artifact_id = _create_artifact(conn, team_id, domain_id, name, entry)
        change_kind = entry.change_kind.value if entry.change_kind else "added"

    # Back-fill resolved ids onto the in-memory entry.
    entry.id = artifact_id
    entry.domain_id = domain_id
    entry.domain = _domain_name_for_id(conn, domain_id)

    conn.execute(
        "INSERT INTO artifact_history "
        "(artifact_id, report_id, meeting_date, change_kind, change_note, source) "
        "VALUES (?, ?, ?, ?, ?, 'report')",
        (artifact_id, report_id, meeting_date, change_kind, entry.note),
    )


def _verify_artifact_in_team(conn: sqlite3.Connection, artifact_id: int, team_id: int) -> int:
    row = conn.execute(
        "SELECT id FROM artifact WHERE id = ? AND team_id = ?",
        (artifact_id, team_id),
    ).fetchone()
    if row is None:
        raise EngineError(
            f"Report references artifact id {artifact_id} which does not exist for this team."
        )
    return row["id"]


def _create_artifact(
    conn: sqlite3.Connection,
    team_id: int,
    domain_id: int | None,
    name: str,
    entry: ReportArtifactEntry,
) -> int:
    cur = conn.execute(
        "INSERT INTO artifact (team_id, domain_id, name, type, tags, summary) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (
            team_id,
            domain_id,
            name,
            entry.type.value if entry.type else None,
            json.dumps(entry.tags) if entry.tags is not None else None,
            entry.summary,
        ),
    )
    return cur.lastrowid


def _update_artifact(
    conn: sqlite3.Connection,
    artifact_id: int,
    domain_id: int | None,
    entry: ReportArtifactEntry,
) -> None:
    """Patch only the artifact fields the entry supplies; a `retired` kind does
    not delete the row (history-only). ``summary`` is the standing description;
    a ``moved`` kind re-places the domain."""
    sets: list[str] = []
    params: list[object] = []
    if entry.type is not None:
        sets.append("type = ?")
        params.append(entry.type.value)
    if entry.tags is not None:
        sets.append("tags = ?")
        params.append(json.dumps(entry.tags))
    if entry.summary is not None:
        sets.append("summary = ?")
        params.append(entry.summary)
    if entry.change_kind and entry.change_kind.value == "moved":
        sets.append("domain_id = ?")
        params.append(domain_id)
    if not sets:
        return
    params.append(artifact_id)
    conn.execute(
        f"UPDATE artifact SET {', '.join(sets)} WHERE id = ?", tuple(params)
    )


def _infer_artifact_change_kind(
    conn: sqlite3.Connection,
    artifact_id: int,
    domain_id: int | None,
    entry: ReportArtifactEntry,
) -> str:
    """Decide added/updated/retired/moved for an existing artifact: explicit
    ``change_kind`` wins; otherwise a domain change → moved, else → updated."""
    if entry.change_kind is not None:
        return entry.change_kind.value
    cur = conn.execute(
        "SELECT domain_id FROM artifact WHERE id = ?", (artifact_id,)
    ).fetchone()
    if cur is not None and cur["domain_id"] != domain_id:
        return "moved"
    return "updated"


def _insert_action_item(
    conn: sqlite3.Connection,
    report_id: int,
    champion_id: int,
    domain_id: int | None,
    item,
) -> None:
    # Mirror the task-owner safety net: a model that emits a null/empty owner
    # defaults to the champion (never an owner-less action item, which would also
    # drop it from the 'AI Lead' worklist incorrectly). An owner the model DID
    # declare — the champion name or the literal "AI Lead" — is left untouched.
    owner = item.owner or _champion_name(conn, champion_id)
    conn.execute(
        "INSERT INTO action_item (report_id, domain_id, text, owner, due_date, status) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (report_id, domain_id, item.text, owner, item.due_date, item.status.value),
    )


# ── edit one report (PATCH /api/reports/{id}) ──────────────────────────────────

def replay_report_edit(
    conn: sqlite3.Connection, report_id: int, doc: ReportDocument
) -> sqlite3.Row:
    """Re-save an edited report with a TARGETED re-apply (no full timeline replay).

    Editing an already-saved OLD report once newer reports exist is not a real
    use case, so the old full-champion re-fan-out is gone. We touch ONLY this
    report's own rows, in one transaction:

      1. delete THIS report's journal + action-item rows — i.e. the rows whose
         ``report_id`` is this report. Manual rows (``source='manual'``,
         ``report_id IS NULL``) are NOT matched, so they are PRESERVED.
      2. overwrite the stored report_json (+ meeting_date / champion).
      3. re-apply the edited document's entries as fresh ``source='report'``
         journal rows (id back-filled, so a brand-new entity created on edit is
         created once and never duplicated — the Wave-9 guarantee), persisting
         the id-complete doc back to report_json.
      4. recompute current-state for every task this report's old OR new
         entries touched, purely from the journal (the preserved manual rows
         participate; if the meeting_date moved, the recompute reflects it).

    The name ``replay_report_edit`` is kept for the public seam; the behaviour is
    now a targeted re-apply, not a replay."""
    with conn:
        existing = get_report_row(conn, report_id)  # raises if missing
        old_champion_id = existing["champion_id"]

        # Tasks touched BEFORE the edit (so a task dropped from the doc still gets
        # its current-state recomputed from whatever journal remains).
        affected_tasks: set[int] = {
            r["task_id"]
            for r in conn.execute(
                "SELECT DISTINCT task_id FROM task_history WHERE report_id = ?",
                (report_id,),
            ).fetchall()
        }

        # 1. wipe ONLY this report's rows. Manual rows have report_id IS NULL and
        #    are not matched here — they survive the edit untouched.
        conn.execute("DELETE FROM task_history WHERE report_id = ?", (report_id,))
        conn.execute("DELETE FROM artifact_history WHERE report_id = ?", (report_id,))
        conn.execute("DELETE FROM action_item WHERE report_id = ?", (report_id,))

        # 2. swap the stored document.
        champion_id = _resolve_champion_id(conn, doc.champion)
        team_id = _champion_team_id(conn, champion_id)
        _check_duplicate_date(
            conn, champion_id, doc.meeting_date, exclude_report_id=report_id
        )
        try:
            conn.execute(
                "UPDATE report SET champion_id = ?, meeting_date = ?, report_json = ?, "
                "schema_version = ? WHERE id = ?",
                (
                    champion_id,
                    doc.meeting_date,
                    doc.model_dump_json(by_alias=True, exclude_none=True),
                    SCHEMA_VERSION,
                    report_id,
                ),
            )
        except sqlite3.IntegrityError as exc:
            if "UNIQUE" in str(exc).upper():
                raise EngineError(
                    f"A report for this champion on {doc.meeting_date} already exists. "
                    "Each champion can have at most one report per meeting date."
                ) from exc
            raise

        # 3. re-apply this report's entries as fresh source='report' rows. We
        #    record-and-back-fill (no per-entry recompute), then recompute the
        #    union of old + new tasks once at the end.
        for entry in doc.tasks:
            task_id, _ = _record_task_entry(
                conn, report_id, doc.meeting_date, champion_id, team_id, entry
            )
            affected_tasks.add(task_id)
        for entry in doc.artifacts:
            _apply_artifact_entry(
                conn, report_id, doc.meeting_date, champion_id, team_id, entry
            )
        for item in doc.action_items:
            item_domain_id = _resolve_entry_domain_id(
                conn, champion_id, team_id, item.domain_id, item.domain, needs_domain=False
            )
            item.domain_id = item_domain_id
            item.domain = _domain_name_for_id(conn, item_domain_id)
            _insert_action_item(conn, report_id, champion_id, item_domain_id, item)

        # Persist the id-complete document (entries created on edit now carry ids).
        conn.execute(
            "UPDATE report SET report_json = ? WHERE id = ?",
            (doc.model_dump_json(by_alias=True, exclude_none=True), report_id),
        )

        # 4. recompute current-state for every touched task from the journal.
        for task_id in affected_tasks:
            _recompute_task_current_state(conn, task_id)

    return get_report_row(conn, report_id)


# ── manual entity edits (PATCH /api/tasks|artifacts/{id}) ──────────────────────
# A direct current-state edit, journaled so the weekly story does not lie. The
# engine owns BOTH the entity update and the journal row (SOLID: routes validate
# + delegate; the engine keeps state and journal consistent in one transaction).

def apply_manual_task_edit(
    conn: sqlite3.Connection, task_id: int, fields: dict
) -> sqlite3.Row:
    """Apply a manual task current-state edit + journal it (one transaction).

    ``fields`` are the already-validated columns to set (any of ``status`` [str],
    ``owner``, ``domain_id``, ``started_on``, ``due_date``). In one transaction:

      1. UPDATE the supplied columns on the ``task`` row.
      2. APPEND one ``source='manual'`` journal row dated TODAY carrying the
         resulting ``status_at_meeting``, the new ``owner`` (so the journal stays
         self-sufficient), the resulting ``due_date`` (a FREE user date carried
         forward from the row, not gated by status), and a ``change_note``
         summarising what changed.
      3. RECOMPUTE current-state from the journal so the manual row participates
         (e.g. owner/due_date derive consistently with report rows).

    Returns the refreshed ``task`` row. Raises EngineError if the task is gone."""
    with conn:
        row = conn.execute("SELECT * FROM task WHERE id = ?", (task_id,)).fetchone()
        if row is None:
            raise EngineError(f"Unknown task id: {task_id}")

        note = _describe_task_changes(conn, row, fields)

        # Suppress no-op: if nothing actually changed, skip the journal row and
        # the recompute entirely — just return the unchanged entity.
        if note == "Manual edit":
            # _describe_task_changes returns bare "Manual edit" iff no field changed.
            return row

        if fields:
            _apply_updates(conn, "task", task_id, fields)

        # Snapshot the resulting current-state onto the manual journal row so it
        # is self-sufficient. ``due_date`` is a FREE user date: whatever the row
        # now holds (carried forward when the edit did not touch it), no gate.
        result = conn.execute(
            "SELECT status, owner, due_date FROM task WHERE id = ?", (task_id,)
        ).fetchone()
        status = result["status"]
        today = datetime.date.today().isoformat()

        conn.execute(
            "INSERT INTO task_history "
            "(task_id, report_id, meeting_date, status_at_meeting, owner, due_date, "
            " change_note, source) "
            "VALUES (?, NULL, ?, ?, ?, ?, ?, 'manual')",
            (task_id, today, status, result["owner"], result["due_date"], note),
        )

        _recompute_task_current_state(conn, task_id)

    return conn.execute("SELECT * FROM task WHERE id = ?", (task_id,)).fetchone()


def apply_manual_artifact_edit(
    conn: sqlite3.Connection, artifact_id: int, fields: dict
) -> sqlite3.Row:
    """Apply a manual artifact current-state edit + journal it (one transaction).

    ``fields`` are the already-validated columns to set (``name``, ``type``,
    ``tags`` [JSON text], ``summary``, ``domain_id``). In one transaction:

      1. UPDATE the supplied columns on the ``artifact`` row.
      2. APPEND one ``source='manual'`` ``artifact_history`` row dated TODAY with
         ``change_kind`` = 'moved' if the domain changed else 'updated', plus a
         ``change_note`` summarising what changed.

    Artifact current-state lives on the ``artifact`` row, so no recompute is
    needed. Returns the refreshed ``artifact`` row. Raises EngineError if gone."""
    with conn:
        row = conn.execute(
            "SELECT * FROM artifact WHERE id = ?", (artifact_id,)
        ).fetchone()
        if row is None:
            raise EngineError(f"Unknown artifact id: {artifact_id}")

        domain_changed = (
            "domain_id" in fields and fields["domain_id"] != row["domain_id"]
        )
        note = _describe_artifact_changes(row, fields)
        change_kind = "moved" if domain_changed else "updated"

        # Suppress no-op: if nothing actually changed, skip the journal row.
        if note == "Manual edit":
            return row

        if fields:
            _apply_updates(conn, "artifact", artifact_id, fields)

        today = datetime.date.today().isoformat()
        conn.execute(
            "INSERT INTO artifact_history "
            "(artifact_id, report_id, meeting_date, change_kind, change_note, source) "
            "VALUES (?, NULL, ?, ?, ?, 'manual')",
            (artifact_id, today, change_kind, note),
        )

    return conn.execute(
        "SELECT * FROM artifact WHERE id = ?", (artifact_id,)
    ).fetchone()


def _apply_updates(
    conn: sqlite3.Connection, table: str, row_id: int, changes: dict
) -> None:
    """UPDATE only the supplied columns of ``table`` row ``row_id``. No-op when
    ``changes`` is empty."""
    if not changes:
        return
    assignments = ", ".join(f"{c} = ?" for c in changes)
    conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ?",
        [*changes.values(), row_id],
    )


def _describe_task_changes(
    conn: sqlite3.Connection, row: sqlite3.Row, fields: dict
) -> str:
    """A terse human note for a manual task edit (only fields that actually
    changed value), e.g. "status: in-progress → abandoned; owner → Dana;
    domain → Backend"."""
    parts: list[str] = []
    labels = {
        "status": "status",
        "owner": "owner",
        "domain_id": "domain",
        "started_on": "started_on",
        "due_date": "due_date",
    }
    for col, label in labels.items():
        if col not in fields:
            continue
        old = row[col]
        new = fields[col]
        if old == new:
            continue
        if col == "domain_id":
            # Resolve domain name for a readable note; fall back to raw id.
            new_name = _domain_name_for_id(conn, new) if new is not None else None
            parts.append(f"domain → {new_name if new_name is not None else new}")
        elif col == "status" and old is not None:
            parts.append(f"{label}: {old} → {new}")
        else:
            parts.append(f"{label} → {new}")
    return "Manual edit (" + "; ".join(parts) + ")" if parts else "Manual edit"


def _describe_artifact_changes(row: sqlite3.Row, fields: dict) -> str:
    """A terse human note for a manual artifact edit (changed fields only)."""
    parts: list[str] = []
    for col in ("name", "type", "tags", "summary", "domain_id"):
        if col not in fields:
            continue
        if row[col] == fields[col]:
            continue
        parts.append("domain" if col == "domain_id" else col)
    return "Manual edit (" + ", ".join(parts) + ")" if parts else "Manual edit"
