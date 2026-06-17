"""Report fan-out + replay engine (spec §5/§6).

Two write paths, each ONE SQLite transaction:

* ``fan_out_report`` — confirm/save a drafted ``ReportDocument``: insert the
  ``report`` row, then fan out to the current-state tables (``task``,
  ``artifact``, ``domain``) and the history tables (``task_history``,
  ``artifact_history``) plus ``action_item`` rows. Current-state is written
  directly (spec §5: "never rebuilt by replaying history").

* ``replay_report_edit`` — edit a saved report (spec §4 "Updating a saved
  report"): delete the history rows this report created, swap the stored
  ``report_json``, then recompute the current-state of every task/artifact the
  champion's reports touch by replaying those reports in ``meeting_date`` order.

Read helpers: ``build_draft_context`` (state hints for the LLM) and
``get_report_row`` (one report, with ``report_json`` left as a JSON string).

Conventions match the rest of the backend: plain functions, parameterized SQL,
``sqlite3.Row`` access, dates as ISO "YYYY-MM-DD" strings.

Design decisions (Wave 2 Agent 2B):

* **First meeting = first report** — no pre-seed assumption anywhere.  The fan-
  out path already handles this; the first report creates tasks with
  ``change_kind = "added"`` and sets ``started_on`` to the first meeting date.

* **``started_on``** = date of the earliest history row (unchanged — already
  correct per spec §4/§6).

* **``ended_on``** — NEVER auto-computed from a trailing terminal-status run.
  It is the user-supplied finish date: ``finished_on`` on the task entry if
  present, otherwise the report's own ``meeting_date`` (only when the latest
  status is terminal).  See ``_ended_on_for_task``.

* **Domain field reset on replay** — before replaying a champion's reports,
  the mutable report-driven fields (``description``, ``scope``, ``priority``,
  ``cross_domain``) are reset to NULL *per domain*, but only for the fields
  that at least one report section actually sets for THAT domain.  A field
  that only a report for domain A ever touches is not NULLed on domain B,
  so management-CRUD-set values on domain B survive edit-replays.
"""

from __future__ import annotations

import json
import sqlite3

from models import ReportArtifactEntry, ReportDocument, ReportDomainSection, SCHEMA_VERSION

# ── design constants ─────────────────────────────────────────────────────────

# Statuses that close a task — used only to decide whether ``ended_on`` should
# be populated (spec §5).  No longer used to walk the trailing run.
_TERMINAL_STATUSES = frozenset(
    {"finished_successfully", "finished_with_issues", "abandoned"}
)

# Domain columns that are driven exclusively by report ``changes`` sections and
# must therefore be reset to NULL before a replay so that removed changes revert.
_DOMAIN_REPORT_FIELDS = ("description", "scope", "priority", "cross_domain")


# ── exceptions ──────────────────────────────────────────────────────────────

class EngineError(RuntimeError):
    """A report could not be saved/edited for a domain reason (e.g. an unknown
    champion or a domain name the report references that the champion lacks)."""


class ReportNotFoundError(EngineError):
    """No ``report`` row with the given id."""


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
) -> int:
    """Match a report section's domain name within THIS champion's domains."""
    target = _norm(domain_name)
    for row in conn.execute(
        "SELECT id, name FROM domain WHERE champion_id = ?", (champion_id,)
    ).fetchall():
        if _norm(row["name"]) == target:
            return row["id"]
    raise EngineError(
        f"Champion {champion_id} has no domain named {domain_name!r}"
    )


def _find_task_id(
    conn: sqlite3.Connection, domain_id: int, task_name: str
) -> int | None:
    target = _norm(task_name)
    for row in conn.execute(
        "SELECT id, name FROM task WHERE domain_id = ?", (domain_id,)
    ).fetchall():
        if _norm(row["name"]) == target:
            return row["id"]
    return None


def _find_artifact_id(
    conn: sqlite3.Connection,
    team_id: int,
    domain_id: int | None,
    artifact_name: str,
) -> int | None:
    """Match an artifact by name within the team, preferring the same domain.

    Artifacts belong to a team and optionally a domain (null = team-wide). We
    match by name within the team; if several share a name we prefer the one in
    the section's domain, else the team-wide one, else the first."""
    target = _norm(artifact_name)
    matches = [
        row
        for row in conn.execute(
            "SELECT id, domain_id, name FROM artifact WHERE team_id = ?",
            (team_id,),
        ).fetchall()
        if _norm(row["name"]) == target
    ]
    if not matches:
        return None
    for row in matches:
        if row["domain_id"] == domain_id:
            return row["id"]
    for row in matches:
        if row["domain_id"] is None:
            return row["id"]
    return matches[0]["id"]


# ── draft context (POST /draft) ────────────────────────────────────────────────

def build_draft_context(conn: sqlite3.Connection, champion_id: int) -> dict:
    """Build the existing-state hints handed to the LLM so it can map/de-dup.

    Shape (decision — flagged as an uncertainty): champion + team identity plus,
    per domain, its current tasks (name/status/owner) and artifacts
    (name/type/tags), and the team-wide (un-domained) artifacts. This is the
    minimum the model needs to reuse names instead of inventing duplicates."""
    champ = conn.execute(
        "SELECT id, name, team_id FROM champion WHERE id = ?", (champion_id,)
    ).fetchone()
    if champ is None:
        raise EngineError(f"Unknown champion id: {champion_id}")
    team = conn.execute(
        "SELECT id, name FROM team WHERE id = ?", (champ["team_id"],)
    ).fetchone()

    def _artifact_summary(row: sqlite3.Row) -> dict:
        return {
            "name": row["name"],
            "type": row["type"],
            "tags": json.loads(row["tags"]) if row["tags"] else [],
        }

    domains: list[dict] = []
    for dom in conn.execute(
        "SELECT id, name, description, scope, priority, cross_domain "
        "FROM domain WHERE champion_id = ? ORDER BY id",
        (champion_id,),
    ).fetchall():
        tasks = [
            {
                "name": t["name"],
                "status": t["status"],
                "owner": t["owner"],
            }
            for t in conn.execute(
                "SELECT name, status, owner FROM task WHERE domain_id = ? ORDER BY id",
                (dom["id"],),
            ).fetchall()
        ]
        artifacts = [
            _artifact_summary(a)
            for a in conn.execute(
                "SELECT name, type, tags FROM artifact WHERE domain_id = ? ORDER BY id",
                (dom["id"],),
            ).fetchall()
        ]
        domains.append(
            {
                "name": dom["name"],
                "description": dom["description"],
                "scope": dom["scope"],
                "priority": dom["priority"],
                "cross_domain": dom["cross_domain"],
                "tasks": tasks,
                "artifacts": artifacts,
            }
        )

    team_wide_artifacts = [
        _artifact_summary(a)
        for a in conn.execute(
            "SELECT name, type, tags FROM artifact "
            "WHERE team_id = ? AND domain_id IS NULL ORDER BY id",
            (champ["team_id"],),
        ).fetchall()
    ]

    return {
        "champion": {"id": champ["id"], "name": champ["name"]},
        "team": {"id": team["id"], "name": team["name"]} if team else None,
        "domains": domains,
        "team_wide_artifacts": team_wide_artifacts,
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
    """Save a confirmed draft: insert the report row and fan out to all tables.

    Runs as ONE transaction (the caller passes a fresh connection; we open an
    explicit transaction here)."""
    with conn:  # one transaction; commits on success, rolls back on error
        champion_id = _resolve_champion_id(conn, doc.champion)
        team_id = _champion_team_id(conn, champion_id)

        report_id = _insert_report_row(conn, champion_id, doc)

        for section in doc.domains:
            domain_id = _resolve_domain_id(conn, champion_id, section.domain)
            _apply_domain_changes(conn, domain_id, section)
            for entry in section.tasks:
                _apply_task_entry(
                    conn, report_id, doc.meeting_date, domain_id, entry
                )
            for entry in section.artifacts:
                _apply_artifact_entry(
                    conn,
                    report_id,
                    doc.meeting_date,
                    team_id,
                    domain_id,
                    entry,
                )

        for item in doc.action_items:
            item_domain_id = (
                _resolve_domain_id(conn, champion_id, item.domain)
                if item.domain
                else None
            )
            _insert_action_item(conn, report_id, item_domain_id, item)

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


def _apply_domain_changes(
    conn: sqlite3.Connection, domain_id: int, section: ReportDomainSection
) -> None:
    """Patch only the domain fields the report says changed (spec §4)."""
    if section.changes is None:
        return
    changes = section.changes.model_dump(exclude_none=True)
    if not changes:
        return
    cols = ", ".join(f"{col} = ?" for col in changes)
    conn.execute(
        f"UPDATE domain SET {cols} WHERE id = ?",
        (*changes.values(), domain_id),
    )


def _apply_task_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    domain_id: int,
    entry,
) -> None:
    """Upsert the current-state task row + append one task_history row."""
    if entry.new_task is not None:
        task_id = _create_task(conn, domain_id, entry.new_task, entry)
    else:
        task_id = _find_task_id(conn, domain_id, entry.task)
        if task_id is None:
            # Existing-task reference that doesn't resolve: treat the name as a
            # new task rather than failing the whole save (decision — flagged).
            task_id = _create_task(conn, domain_id, entry.task, entry)

    # history row first, then derive current state from full history.
    conn.execute(
        "INSERT INTO task_history "
        "(task_id, report_id, meeting_date, status_at_meeting, change_note) "
        "VALUES (?, ?, ?, ?, ?)",
        (task_id, report_id, meeting_date, entry.status.value, entry.note),
    )
    _recompute_task_current_state(conn, task_id)


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
      when the task's latest status is terminal.  Never auto-computed from a
      trailing status run.
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

    # Owner: most recent report that set one (history has no owner column, so we
    # read it from the stored report_json of the latest report touching the task).
    owner = _latest_owner_for_task(conn, task_id)

    conn.execute(
        "UPDATE task SET status = ?, owner = ?, started_on = ?, ended_on = ? "
        "WHERE id = ?",
        (latest_status, owner, started_on, ended_on, task_id),
    )


def _ended_on_for_task(
    conn: sqlite3.Connection,
    task_id: int,
    report_id: int,
    meeting_date: str,
) -> str:
    """Return the user-supplied finish date for a task that just turned terminal.

    Reads the stored ``report_json`` of *report_id* and looks for a
    ``finished_on`` field on the matching task entry.  Falls back to
    ``meeting_date`` (the report's own date) when no override is present.

    This is the ONLY place ``ended_on`` is derived — no trailing-run logic."""
    name_row = conn.execute("SELECT name FROM task WHERE id = ?", (task_id,)).fetchone()
    if name_row is None:
        return meeting_date
    task_name = _norm(name_row["name"])

    report_row = conn.execute(
        "SELECT report_json, meeting_date FROM report WHERE id = ?", (report_id,)
    ).fetchone()
    if report_row is None:
        return meeting_date

    doc = json.loads(report_row["report_json"])
    for section in doc.get("domains", []):
        for entry in section.get("tasks", []):
            name = entry.get("task") or entry.get("new_task")
            if name and _norm(name) == task_name:
                return entry.get("finished_on") or report_row["meeting_date"]
    # Task entry not found in this report (shouldn't happen, but be safe).
    return meeting_date


def _latest_owner_for_task(conn: sqlite3.Connection, task_id: int) -> str | None:
    """Owner from the most recent report (by date) whose entry for this task
    carried an owner; falls back to whatever the task row already has."""
    name_row = conn.execute("SELECT name FROM task WHERE id = ?", (task_id,)).fetchone()
    if name_row is None:
        return None
    task_name = _norm(name_row["name"])
    rows = conn.execute(
        "SELECT r.report_json FROM task_history th "
        "JOIN report r ON r.id = th.report_id "
        "WHERE th.task_id = ? "
        "ORDER BY th.meeting_date DESC, th.report_id DESC",
        (task_id,),
    ).fetchall()
    for row in rows:
        doc = json.loads(row["report_json"])
        for section in doc.get("domains", []):
            for entry in section.get("tasks", []):
                name = entry.get("task") or entry.get("new_task")
                if name and _norm(name) == task_name and entry.get("owner"):
                    return entry["owner"]
    # nothing in history set an owner — keep current.
    cur = conn.execute("SELECT owner FROM task WHERE id = ?", (task_id,)).fetchone()
    return cur["owner"] if cur else None


def _apply_artifact_entry(
    conn: sqlite3.Connection,
    report_id: int,
    meeting_date: str,
    team_id: int,
    domain_id: int | None,
    entry: ReportArtifactEntry,
) -> None:
    """Upsert the current-state artifact row + append one artifact_history row."""
    is_new = entry.new_artifact is not None
    name = entry.new_artifact if is_new else entry.artifact

    artifact_id = (
        None if is_new else _find_artifact_id(conn, team_id, domain_id, name)
    )

    if artifact_id is None:
        # Artifact will be created (explicit new_artifact, or an `artifact:`
        # reference that didn't resolve). `artifact.type` is NOT NULL, but the
        # report contract allows entries without a type — reject those here as a
        # domain error (→ 422) instead of letting raw sqlite3.IntegrityError
        # escape as an unhandled 500.
        if entry.type is None:
            raise EngineError(f"artifact {name!r} is new but has no type")
        artifact_id = _create_artifact(conn, team_id, domain_id, name, entry)
        change_kind = entry.change_kind.value if entry.change_kind else "added"
    else:
        change_kind = _infer_artifact_change_kind(conn, artifact_id, domain_id, entry)
        _update_artifact(conn, artifact_id, domain_id, entry)

    conn.execute(
        "INSERT INTO artifact_history "
        "(artifact_id, report_id, meeting_date, change_kind, change_note) "
        "VALUES (?, ?, ?, ?, ?)",
        (artifact_id, report_id, meeting_date, change_kind, entry.note),
    )


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
            entry.note,
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
    not delete the row (history-only)."""
    sets: list[str] = []
    params: list[object] = []
    if entry.type is not None:
        sets.append("type = ?")
        params.append(entry.type.value)
    if entry.tags is not None:
        sets.append("tags = ?")
        params.append(json.dumps(entry.tags))
    if entry.note is not None:
        sets.append("summary = ?")
        params.append(entry.note)
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
    """Decide added/updated/retired/moved for an existing artifact (decision —
    flagged): explicit ``change_kind`` wins; otherwise a domain change → moved,
    anything else → updated."""
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
    """
    with conn:
        existing = get_report_row(conn, report_id)  # raises if missing
        champion_id = existing["champion_id"]

        # 1. wipe everything this report wrote into the history/action tables.
        conn.execute("DELETE FROM task_history WHERE report_id = ?", (report_id,))
        conn.execute("DELETE FROM artifact_history WHERE report_id = ?", (report_id,))
        conn.execute("DELETE FROM action_item WHERE report_id = ?", (report_id,))

        # 2. swap the stored document. The edited doc must stay the same report
        #    (same id/champion); we trust its meeting_date for re-ordering.
        new_champion_id = _resolve_champion_id(conn, doc.champion)
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

        # 3. replay this champion's whole timeline.
        _replay_champion(conn, new_champion_id)
        if new_champion_id != champion_id:
            _replay_champion(conn, champion_id)

    return get_report_row(conn, report_id)


def _replay_champion(conn: sqlite3.Connection, champion_id: int) -> None:
    """Rebuild history + current-state for one champion from stored report_json.

    Idempotent: clears this champion's history rows, then re-fans-out every one
    of the champion's reports in (meeting_date, id) order. Current-state rows
    that the timeline no longer references keep their last computed value
    (entities are not deleted on replay — decision, flagged).

    Domain field reset: before replaying, ``description / scope / priority /
    cross_domain`` are reset to NULL **per domain** — but only for the fields
    that at least one of THIS domain's report sections actually sets (non-None
    value in the ``changes`` block, matching ``_apply_domain_changes`` semantics).
    A field never mentioned in any report for domain X is left untouched on X,
    preserving any management-CRUD value set outside the report flow."""
    reports = conn.execute(
        "SELECT id, meeting_date, report_json FROM report "
        "WHERE champion_id = ? ORDER BY meeting_date ASC, id ASC",
        (champion_id,),
    ).fetchall()

    # Collect the domain ids for this champion so we can scope the history wipe
    # and the domain-field reset.
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

    # Reset only the domain fields that at least one report for THAT SPECIFIC
    # domain sets via a ``changes`` block — scoped per domain so that a field
    # touched only in domain A is not NULLed on domain B (which may have had
    # that field set directly by management CRUD).
    #
    # Build: domain_id -> set of field names whose value is non-None in at least
    # one report section that resolves to that domain.  "Touched" mirrors
    # ``_apply_domain_changes``'s ``model_dump(exclude_none=True)`` semantics:
    # only keys present with a non-None value count.
    domain_touched_fields: dict[int, set[str]] = {}
    for rep in reports:
        doc = ReportDocument.model_validate_json(rep["report_json"])
        for section in doc.domains:
            if section.changes is None:
                continue
            changed = (
                set(section.changes.model_dump(exclude_none=True)) & set(_DOMAIN_REPORT_FIELDS)
            )
            if not changed:
                continue
            try:
                did = _resolve_domain_id(conn, champion_id, section.domain)
            except EngineError:
                continue  # mirror replay loop: skip unresolvable domain sections
            domain_touched_fields.setdefault(did, set()).update(changed)

    # Issue a targeted NULL reset per domain for only its touched fields.
    for did, touched in domain_touched_fields.items():
        reset_cols = ", ".join(
            f"{col} = NULL" for col in _DOMAIN_REPORT_FIELDS if col in touched
        )
        conn.execute(f"UPDATE domain SET {reset_cols} WHERE id = ?", (did,))

    touched_tasks: set[int] = set()
    # Artifact ids that already received a history row in THIS replay pass — the
    # first row for an artifact is its `added` event regardless of the row
    # surviving from before the edit.
    seen_artifacts: set[int] = set()
    for rep in reports:
        doc = ReportDocument.model_validate_json(rep["report_json"])
        team_id = _champion_team_id(conn, champion_id)
        for section in doc.domains:
            try:
                domain_id = _resolve_domain_id(conn, champion_id, section.domain)
            except EngineError:
                continue
            _apply_domain_changes(conn, domain_id, section)
            for entry in section.tasks:
                name = entry.new_task or entry.task
                task_id = _find_task_id(conn, domain_id, name)
                if task_id is None:
                    task_id = _create_task(conn, domain_id, name, entry)
                conn.execute(
                    "INSERT INTO task_history "
                    "(task_id, report_id, meeting_date, status_at_meeting, change_note) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (task_id, rep["id"], rep["meeting_date"], entry.status.value, entry.note),
                )
                touched_tasks.add(task_id)
            for entry in section.artifacts:
                _replay_artifact_entry(
                    conn,
                    rep["id"],
                    rep["meeting_date"],
                    team_id,
                    domain_id,
                    entry,
                    seen_artifacts,
                )
        for item in doc.action_items:
            try:
                item_domain_id = (
                    _resolve_domain_id(conn, champion_id, item.domain)
                    if item.domain
                    else None
                )
            except EngineError:
                continue  # mirror replay loop: skip unresolvable domain sections
            _insert_action_item(conn, rep["id"], item_domain_id, item)

    for task_id in touched_tasks:
        _recompute_task_current_state(conn, task_id)
    # also recompute any task in this champion's domains that lost all history.
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
    team_id: int,
    domain_id: int | None,
    entry: ReportArtifactEntry,
    seen_artifacts: set[int],
) -> None:
    is_new = entry.new_artifact is not None
    name = entry.new_artifact if is_new else entry.artifact
    artifact_id = _find_artifact_id(conn, team_id, domain_id, name)
    if artifact_id is None:
        # Same NOT NULL guard as the fan-out create path (artifact.type).
        if entry.type is None:
            raise EngineError(f"artifact {name!r} is new but has no type")
        artifact_id = _create_artifact(conn, team_id, domain_id, name, entry)
        change_kind = entry.change_kind.value if entry.change_kind else "added"
    elif artifact_id not in seen_artifacts:
        # First history row for this artifact in the replay = its `added` event,
        # even though the current-state row already exists from before the edit.
        change_kind = entry.change_kind.value if entry.change_kind else "added"
        _update_artifact(conn, artifact_id, domain_id, entry)
    else:
        change_kind = _infer_artifact_change_kind(conn, artifact_id, domain_id, entry)
        _update_artifact(conn, artifact_id, domain_id, entry)
    seen_artifacts.add(artifact_id)
    conn.execute(
        "INSERT INTO artifact_history "
        "(artifact_id, report_id, meeting_date, change_kind, change_note) "
        "VALUES (?, ?, ?, ?, ?)",
        (artifact_id, report_id, meeting_date, change_kind, entry.note),
    )
