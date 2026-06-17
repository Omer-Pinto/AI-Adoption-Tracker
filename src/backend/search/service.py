"""Search DSL service — the cross-agent seam consumed by Agent 1B.

Agent 1B's ``/api/tasks`` and ``/api/artifacts`` list endpoints import EXACTLY::

    from search import filter_tasks, filter_artifacts, ParseError

These functions parse + compile the ``q`` DSL (api_contract §4) into a SQLite
WHERE over the task / artifact list and return real ``models.Task`` /
``models.Artifact`` instances (current-state rows).

This module owns the SELECT/JOIN skeletons; the WHERE body comes from
``compiler.compile_where``. The vendored soccer service (BetRow mapping,
aggregates, get_cursor TODO) was replaced wholesale.
"""
from __future__ import annotations

import json
import sqlite3

from models import Artifact, ArtifactType, Task, TaskStatus

from .compiler import ARTIFACT_CONTEXT, TASK_CONTEXT, compile_where
from .parser import ParseError, parse

# ---------------------------------------------------------------------------
# SELECT/JOIN skeletons (current-state rows only)
# ---------------------------------------------------------------------------
# Task: join up to domain + team so `team:` / `domain:` clauses resolve.
_TASK_SELECT = """
SELECT t.id, t.domain_id, t.name, t.status, t.owner, t.started_on, t.ended_on
FROM task t
JOIN domain d ON t.domain_id = d.id
JOIN team m ON d.team_id = m.id
WHERE {where}
ORDER BY t.id
""".strip()

# Artifact: team is direct (a.team_id); domain is nullable (LEFT JOIN).
_ARTIFACT_SELECT = """
SELECT a.id, a.team_id, a.domain_id, a.name, a.type, a.tags, a.summary
FROM artifact a
JOIN team m ON a.team_id = m.id
LEFT JOIN domain d ON a.domain_id = d.id
WHERE {where}
ORDER BY a.id
""".strip()


def _row_to_task(row: sqlite3.Row) -> Task:
    return Task(
        id=row["id"],
        domain_id=row["domain_id"],
        name=row["name"],
        status=TaskStatus(row["status"]),
        owner=row["owner"],
        started_on=row["started_on"],
        ended_on=row["ended_on"],
    )


def _row_to_artifact(row: sqlite3.Row) -> Artifact:
    raw_tags = row["tags"]
    tags: list[str] = json.loads(raw_tags) if raw_tags else []
    return Artifact(
        id=row["id"],
        team_id=row["team_id"],
        domain_id=row["domain_id"],
        name=row["name"],
        type=ArtifactType(row["type"]),
        tags=tags,
        summary=row["summary"],
    )


def filter_tasks(conn: sqlite3.Connection, q: str | None) -> list[Task]:
    """Return current-state tasks matching the ``q`` DSL.

    ``q`` None/empty → ALL current-state tasks. Otherwise compile ``q`` into a
    WHERE over the task list (joined task→domain→team for ``team`` / ``domain``
    keys). Artifact-only keys (``type``, ``tag``) are ignored.

    Raises:
        ParseError: On an unknown DSL key.
    """
    ast = parse(q or "")  # ParseError propagates on unknown key
    where_body, params = compile_where(ast, TASK_CONTEXT)
    sql = _TASK_SELECT.format(where=where_body)
    cur = conn.execute(sql, params)
    return [_row_to_task(r) for r in cur.fetchall()]


def filter_artifacts(conn: sqlite3.Connection, q: str | None) -> list[Artifact]:
    """Return current-state artifacts matching the ``q`` DSL.

    ``q`` None/empty → ALL current-state artifacts. Otherwise compile ``q`` into
    a WHERE over the artifact list (artifact has ``team_id`` directly + nullable
    ``domain_id``). ``tags`` JSON is parsed to ``list[str]``. Task-only key
    (``status``) is ignored.

    Raises:
        ParseError: On an unknown DSL key.
    """
    ast = parse(q or "")  # ParseError propagates on unknown key
    where_body, params = compile_where(ast, ARTIFACT_CONTEXT)
    sql = _ARTIFACT_SELECT.format(where=where_body)
    cur = conn.execute(sql, params)
    return [_row_to_artifact(r) for r in cur.fetchall()]
