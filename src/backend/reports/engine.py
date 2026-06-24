"""Report fan-out + replay engine (spec §5/§6).

Two write paths, each ONE SQLite transaction:

* ``fan_out_report`` — confirm/save a drafted ``ReportDocument``: insert the
  ``report`` row, then fan out the FLAT ``tasks``/``artifacts``/``action_items``
  lists to the current-state tables (``task``, ``artifact``) and the history
  tables (``task_history``, ``artifact_history``) plus ``action_item`` rows.
  Current-state is written directly (spec §5: "never rebuilt by replaying
  history").

* ``replay_report_edit`` — edit a saved report (spec §4 "Updating a saved
  report"): delete the history rows this report created, swap the stored
  ``report_json``, then recompute the current-state of every task/artifact the
  champion's reports touch by replaying those reports in ``meeting_date`` order.

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

* **``ended_on``** — NEVER auto-computed from a trailing terminal-status run.
  It is the user-supplied finish date: ``finished_on`` on the task entry if
  present, otherwise the report's own ``meeting_date`` (only when the latest
  status is terminal). See ``_ended_on_for_task``.
"""

from __future__ import annotations

import json
import sqlite3

from models import ReportArtifactEntry, ReportDocument, SCHEMA_VERSION

# ── design constants ─────────────────────────────────────────────────────────

# Statuses that close a task — used only to decide whether ``ended_on`` should
# be populated (spec §5).  No longer used to walk the trailing run.
_TERMINAL_STATUSES = frozenset(
    {"finished_successfully", "finished_with_issues", "abandoned"}
)


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


def _ensure_general_domain(conn: sqlite3.Connection, champion_id: int, team_id: int) -> int:
    """Ensure a per-champion 'General' catch-all domain exists; return its id.

    Domains are tech/stack areas the user defines manually. 'General' is the one
    system-provided bucket: the model parks tasks/artifacts it cannot confidently
    place here, and the user reassigns them to a real domain in the UI."""
    target = _norm(_GENERAL_DOMAIN_NAME)
    for row in conn.execute(
        "SELECT id, name FROM domain WHERE champion_id = ?", (champion_id,)
    ).fetchall():
        if _norm(row["name"]) == target:
            return row["id"]
    cur = conn.execute(
        "INSERT INTO domain (team_id, champion_id, name, description) VALUES (?, ?, ?, ?)",
        (team_id, champion_id, _GENERAL_DOMAIN_NAME,
         "Catch-all for items not yet assigned to a specific domain."),
    )
    return cur.lastrowid


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

    # Guarantee the 'General' catch-all domain exists so it is offered to the
    # model (as a fallback bucket) and to the UI domain picker.
    _ensure_general_domain(conn, champion_id, team_id)
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
            _insert_action_item(conn, report_id, item_domain_id, item)

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


def _apply_task_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    champion_id: int,
    team_id: int,
    entry,
) -> None:
    """Resolve/create the current-state task row + append one task_history row.

    A task always needs a domain → falls back to 'General'. A MATCHED task
    (``entry.id`` set) is re-placed to its resolved domain so re-placement via the
    report works. Back-fills the resolved ids onto the entry."""
    domain_id = _resolve_entry_domain_id(
        conn, champion_id, team_id, entry.domain_id, entry.domain, needs_domain=True
    )

    if entry.id is not None:
        task_id = _verify_task_in_team(conn, entry.id, champion_id)
        # Re-place a matched task to the resolved domain (decision: report
        # placement is authoritative for an explicitly-referenced task).
        conn.execute(
            "UPDATE task SET domain_id = ? WHERE id = ?", (domain_id, task_id)
        )
    else:
        task_id = _create_task(conn, domain_id, entry.task, entry)

    # Back-fill resolved ids onto the in-memory entry.
    entry.id = task_id
    entry.domain_id = domain_id
    entry.domain = _domain_name_for_id(conn, domain_id)

    conn.execute(
        "INSERT INTO task_history "
        "(task_id, report_id, meeting_date, status_at_meeting, change_note) "
        "VALUES (?, ?, ?, ?, ?)",
        (task_id, report_id, meeting_date, entry.status.value, entry.note),
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
    conn: sqlite3.Connection, domain_id: int, name: str, entry
) -> int:
    cur = conn.execute(
        "INSERT INTO task (domain_id, name, status, owner) VALUES (?, ?, ?, ?)",
        (domain_id, name, entry.status.value, entry.owner),
    )
    return cur.lastrowid


def _recompute_task_current_state(conn: sqlite3.Connection, task_id: int) -> None:
    """Set task.status/owner/started_on/ended_on from its full history journey.

    * ``started_on`` = meeting_date of the earliest history row (spec §4/§6).
    * ``ended_on``   = user-supplied finish date (spec §5): ``finished_on`` on
      the task entry if present, else the report's ``meeting_date`` — but ONLY
      when the task's latest status is terminal.  Never auto-computed.
    * ``owner``      = most recent report that named one.
    * ``status``     = latest status."""
    rows = conn.execute(
        "SELECT th.meeting_date, th.status_at_meeting, th.change_note, th.report_id "
        "FROM task_history th WHERE th.task_id = ? "
        "ORDER BY th.meeting_date ASC, th.report_id ASC",
        (task_id,),
    ).fetchall()
    if not rows:
        return

    started_on = rows[0]["meeting_date"]
    latest_row = rows[-1]
    latest_status = latest_row["status_at_meeting"]

    ended_on: str | None = None
    if latest_status in _TERMINAL_STATUSES:
        ended_on = _ended_on_for_task(
            conn, task_id, latest_row["report_id"], latest_row["meeting_date"]
        )

    owner = _latest_owner_for_task(conn, task_id)

    conn.execute(
        "UPDATE task SET status = ?, owner = ?, started_on = ?, ended_on = ? "
        "WHERE id = ?",
        (latest_status, owner, started_on, ended_on, task_id),
    )


def _task_entry_matches(entry: dict, task_id: int, task_name: str) -> bool:
    """A flat task entry refers to *task_id*/*task_name* if its ``id`` matches
    (preferred, now that report_json is id-complete) or, lacking an id, its name."""
    eid = entry.get("id")
    if eid is not None:
        return eid == task_id
    name = entry.get("task")
    return bool(name) and _norm(name) == _norm(task_name)


def _ended_on_for_task(
    conn: sqlite3.Connection,
    task_id: int,
    report_id: int,
    meeting_date: str,
) -> str:
    """Return the user-supplied finish date for a task that just turned terminal.

    Reads the FLAT ``doc["tasks"]`` of *report_id*, matching the task by ``id``
    (falling back to name), and returns its ``finished_on`` override, else the
    report's ``meeting_date``. This is the ONLY place ``ended_on`` is derived."""
    name_row = conn.execute("SELECT name FROM task WHERE id = ?", (task_id,)).fetchone()
    if name_row is None:
        return meeting_date
    task_name = name_row["name"]

    report_row = conn.execute(
        "SELECT report_json, meeting_date FROM report WHERE id = ?", (report_id,)
    ).fetchone()
    if report_row is None:
        return meeting_date

    doc = json.loads(report_row["report_json"])
    for entry in doc.get("tasks", []):
        if _task_entry_matches(entry, task_id, task_name):
            return entry.get("finished_on") or report_row["meeting_date"]
    return meeting_date


def _latest_owner_for_task(conn: sqlite3.Connection, task_id: int) -> str | None:
    """Owner from the most recent report (by date) whose FLAT task entry for this
    task carried an owner; falls back to whatever the task row already has."""
    name_row = conn.execute("SELECT name FROM task WHERE id = ?", (task_id,)).fetchone()
    if name_row is None:
        return None
    task_name = name_row["name"]
    rows = conn.execute(
        "SELECT r.report_json FROM task_history th "
        "JOIN report r ON r.id = th.report_id "
        "WHERE th.task_id = ? "
        "ORDER BY th.meeting_date DESC, th.report_id DESC",
        (task_id,),
    ).fetchall()
    for row in rows:
        doc = json.loads(row["report_json"])
        for entry in doc.get("tasks", []):
            if _task_entry_matches(entry, task_id, task_name) and entry.get("owner"):
                return entry["owner"]
    cur = conn.execute("SELECT owner FROM task WHERE id = ?", (task_id,)).fetchone()
    return cur["owner"] if cur else None


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
        "(artifact_id, report_id, meeting_date, change_kind, change_note) "
        "VALUES (?, ?, ?, ?, ?)",
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
    domain_id: int | None,
    item,
) -> None:
    conn.execute(
        "INSERT INTO action_item (report_id, domain_id, text, owner, due_date, resolved) "
        "VALUES (?, ?, ?, ?, ?, 0)",
        (report_id, domain_id, item.text, item.owner, item.due_date),
    )


# ── edit + replay (PATCH /api/reports/{id}) ────────────────────────────────────

def replay_report_edit(
    conn: sqlite3.Connection, report_id: int, doc: ReportDocument
) -> sqlite3.Row:
    """Re-save an edited report and recompute current-state by replaying.

    One transaction (spec §4 "Updating a saved report"):
      1. delete the history rows + action items this report created,
      2. overwrite the stored report_json (+ meeting_date),
      3. replay ALL of this champion's reports in meeting_date order so every
         touched current-state row reflects the corrected sequence.

    The stored report_json is id-complete (back-filled at save), so replay is
    purely id-based — no duplicate entities are created.
    """
    with conn:
        existing = get_report_row(conn, report_id)  # raises if missing
        champion_id = existing["champion_id"]

        # 1. wipe everything this report wrote into the history/action tables.
        conn.execute("DELETE FROM task_history WHERE report_id = ?", (report_id,))
        conn.execute("DELETE FROM artifact_history WHERE report_id = ?", (report_id,))
        conn.execute("DELETE FROM action_item WHERE report_id = ?", (report_id,))

        # 2. swap the stored document.
        new_champion_id = _resolve_champion_id(conn, doc.champion)

        # Guard against a date already used by a *different* report for this
        # champion (exclude self so re-submitting the same date is fine).
        _check_duplicate_date(
            conn, new_champion_id, doc.meeting_date, exclude_report_id=report_id
        )

        try:
            conn.execute(
                "UPDATE report SET champion_id = ?, meeting_date = ?, report_json = ?, "
                "schema_version = ? WHERE id = ?",
                (
                    new_champion_id,
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

        # 3. replay this champion's whole timeline (both, if champion changed).
        _replay_champion(conn, new_champion_id)
        if new_champion_id != champion_id:
            _replay_champion(conn, champion_id)

    return get_report_row(conn, report_id)


def _replay_champion(conn: sqlite3.Connection, champion_id: int) -> None:
    """Rebuild history + current-state for one champion from stored report_json.

    Idempotent: clears this champion's history rows, then re-applies every one of
    the champion's reports in (meeting_date, id) order. Replay is purely id-based:
    the stored report_json is id-complete, so a matched entry resolves to its
    existing row and a (now-rare) entry without an id is created once.

    Reports do NOT carry domain ``changes`` — replay never touches a domain's
    description/priority (those are owned by the Smart-extract / management flow).
    Current-state rows the timeline no longer references keep their last value."""
    reports = conn.execute(
        "SELECT id, meeting_date, report_json FROM report "
        "WHERE champion_id = ? ORDER BY meeting_date ASC, id ASC",
        (champion_id,),
    ).fetchall()

    team_id = _champion_team_id(conn, champion_id)
    domain_ids = [
        r["id"]
        for r in conn.execute(
            "SELECT id FROM domain WHERE champion_id = ?", (champion_id,)
        ).fetchall()
    ]
    report_ids = [r["id"] for r in reports]

    # Clear history for this champion's reports (re-derived below). Current-state
    # rows are kept; their status/dates are recomputed as we replay.
    if report_ids:
        placeholders = ",".join("?" * len(report_ids))
        conn.execute(
            f"DELETE FROM task_history WHERE report_id IN ({placeholders})",
            report_ids,
        )
        conn.execute(
            f"DELETE FROM artifact_history WHERE report_id IN ({placeholders})",
            report_ids,
        )
        conn.execute(
            f"DELETE FROM action_item WHERE report_id IN ({placeholders})",
            report_ids,
        )

    touched_tasks: set[int] = set()
    # Artifact ids that already received a history row in THIS replay pass — the
    # first row for an artifact is its `added` event.
    seen_artifacts: set[int] = set()

    for rep in reports:
        doc = ReportDocument.model_validate_json(rep["report_json"])
        doc_mutated = False
        for entry in doc.tasks:
            domain_id = _resolve_entry_domain_id(
                conn, champion_id, team_id, entry.domain_id, entry.domain, needs_domain=True
            )
            if entry.id is not None:
                task_id = _verify_task_in_team(conn, entry.id, champion_id)
                conn.execute(
                    "UPDATE task SET domain_id = ? WHERE id = ?", (domain_id, task_id)
                )
            else:
                task_id = _create_task(conn, domain_id, entry.task, entry)
                doc_mutated = True
            # Back-fill resolved ids onto the in-memory entry so any id=None
            # entries get a real id written back to report_json (prevents
            # duplicates on subsequent replays).
            entry.id = task_id
            entry.domain_id = domain_id
            entry.domain = _domain_name_for_id(conn, domain_id)
            conn.execute(
                "INSERT INTO task_history "
                "(task_id, report_id, meeting_date, status_at_meeting, change_note) "
                "VALUES (?, ?, ?, ?, ?)",
                (task_id, rep["id"], rep["meeting_date"], entry.status.value, entry.note),
            )
            touched_tasks.add(task_id)
        for entry in doc.artifacts:
            pre_id = entry.id
            _replay_artifact_entry(
                conn, rep["id"], rep["meeting_date"], champion_id, team_id, entry, seen_artifacts
            )
            if pre_id is None:
                doc_mutated = True
        for item in doc.action_items:
            item_domain_id = _resolve_entry_domain_id(
                conn, champion_id, team_id, item.domain_id, item.domain, needs_domain=False
            )
            # Back-fill domain resolution onto the action item so stored doc
            # reflects the resolved domain id (idempotent; low cost).
            item.domain_id = item_domain_id
            item.domain = _domain_name_for_id(conn, item_domain_id)
            _insert_action_item(conn, rep["id"], item_domain_id, item)
        # Persist the id-complete document if any entry was newly created
        # (had id=None at load time).  This makes ALL paths id-complete in
        # storage: fresh save, edit-same-report, edit-other-report, and any
        # brand-new entity created during replay.
        if doc_mutated:
            conn.execute(
                "UPDATE report SET report_json = ? WHERE id = ?",
                (doc.model_dump_json(by_alias=True, exclude_none=True), rep["id"]),
            )

    for task_id in touched_tasks:
        _recompute_task_current_state(conn, task_id)
    # Recompute any task in this champion's domains that lost all history.
    if domain_ids:
        placeholders = ",".join("?" * len(domain_ids))
        for row in conn.execute(
            f"SELECT id FROM task WHERE domain_id IN ({placeholders})", domain_ids
        ).fetchall():
            if row["id"] not in touched_tasks:
                _recompute_task_current_state(conn, row["id"])


def _replay_artifact_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    champion_id: int,
    team_id: int,
    entry: ReportArtifactEntry,
    seen_artifacts: set[int],
) -> None:
    domain_id = _resolve_entry_domain_id(
        conn, champion_id, team_id, entry.domain_id, entry.domain, needs_domain=False
    )
    name = entry.artifact
    if entry.id is not None:
        artifact_id = _verify_artifact_in_team(conn, entry.id, team_id)
        if artifact_id not in seen_artifacts:
            # First history row for this artifact in the replay = its `added` event.
            change_kind = entry.change_kind.value if entry.change_kind else "added"
        else:
            change_kind = _infer_artifact_change_kind(conn, artifact_id, domain_id, entry)
        _update_artifact(conn, artifact_id, domain_id, entry)
    else:
        if entry.type is None:
            raise EngineError(f"artifact {name!r} is new but has no type")
        artifact_id = _create_artifact(conn, team_id, domain_id, name, entry)
        change_kind = entry.change_kind.value if entry.change_kind else "added"
    seen_artifacts.add(artifact_id)
    # Back-fill resolved ids onto the in-memory entry so the caller can detect
    # that this was a newly-created artifact (pre_id was None) and persist the
    # id-complete doc to report_json.
    entry.id = artifact_id
    entry.domain_id = domain_id
    entry.domain = _domain_name_for_id(conn, domain_id)
    conn.execute(
        "INSERT INTO artifact_history "
        "(artifact_id, report_id, meeting_date, change_kind, change_note) "
        "VALUES (?, ?, ?, ?, ?)",
        (artifact_id, report_id, meeting_date, change_kind, entry.note),
    )
