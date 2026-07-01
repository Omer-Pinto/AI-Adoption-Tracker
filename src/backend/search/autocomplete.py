"""Autocomplete value providers for the search chip bar.

Adapted from the vendored SoccerSmartBet filter-values endpoint. The vendored
TTL cache, Postgres ``to_char``/``isoformat`` date handling, numeric (stake /
odds) kinds and soccer enum-alias labels were removed. This module is now a
pure helper layer (no FastAPI, no caching) used by ``routes/search.py`` to build
the tagged ``{key, kind, values:[{value,label}]}`` response (api_contract §4).

Per-key ``kind`` (1D mapping):
  * ``team``, ``domain`` → ``enum`` (values from the ``team`` / ``domain`` tables)
  * ``type``             → ``enum`` (fixed artifact-type set)
  * ``status``           → ``enum`` (fixed task-status set)
  * ``tag``              → ``free`` (fixed §5 tag set ∪ tags seen in the DB)
  * ``date``             → ``date`` (no value list — the UI shows a picker)
"""
from __future__ import annotations

import json
import sqlite3

from models import ArtifactType, TaskStatus

from .parser import VALID_KEYS

__all__ = ["VALID_KEYS", "build_values"]

# Fixed §5 artifact tag set (spec §5). Free-text tags seen in the DB are merged
# in at query time; `kind` stays "free" because arbitrary tags are allowed.
_FIXED_TAGS: tuple[str, ...] = (
    "in_use_by_champ_only",
    "in_use_by_team",
    "under_test",
    "proved_worthy",
    "updated_periodically",
    "not_updated",
    "created_by_enablement_lead",
    "problematic",
)


def _value_label(value: str, label: str) -> dict[str, str]:
    return {"value": value, "label": label}


def _humanize(token: str) -> str:
    """Turn an enum token into a display label: ``in-progress`` → ``In progress``."""
    return token.replace("_", " ").replace("-", " ").capitalize()


def _placeholders(allowed: set[int]) -> str:
    """Build a `?,?,…` placeholder run for an `IN (…)` clause (parameterized)."""
    return ",".join("?" * len(allowed))


def _teams(
    conn: sqlite3.Connection, allowed: set[int] | None
) -> list[dict[str, str]]:
    """Team names, scoped to `allowed` team ids (None = all, empty set = none)."""
    if allowed is None:
        rows = conn.execute("SELECT name FROM team ORDER BY name").fetchall()
    elif not allowed:
        return []
    else:
        rows = conn.execute(
            f"SELECT name FROM team WHERE id IN ({_placeholders(allowed)}) "
            "ORDER BY name",
            tuple(allowed),
        ).fetchall()
    return [_value_label(r["name"], r["name"]) for r in rows]


def _domains(
    conn: sqlite3.Connection, allowed: set[int] | None
) -> list[dict[str, str]]:
    """Domain names, scoped to domains whose `team_id` ∈ `allowed`.

    None = all domains; an empty `allowed` set = no readable teams → no domains.
    """
    if allowed is None:
        rows = conn.execute("SELECT name FROM domain ORDER BY name").fetchall()
    elif not allowed:
        return []
    else:
        rows = conn.execute(
            f"SELECT name FROM domain WHERE team_id IN ({_placeholders(allowed)}) "
            "ORDER BY name",
            tuple(allowed),
        ).fetchall()
    return [_value_label(r["name"], r["name"]) for r in rows]


def _tags(
    conn: sqlite3.Connection, allowed: set[int] | None
) -> list[dict[str, str]]:
    """Tag values: the fixed §5 set ∪ tags seen on readable artifacts.

    The fixed set is always offered (it is not team-identifying). DB-seen tags are
    restricted to artifacts of `allowed` teams so a scoped user cannot mine tags
    that exist only on out-of-scope artifacts. None = all artifacts; an empty
    `allowed` set contributes no DB tags (fixed set only).
    """
    seen: set[str] = set(_FIXED_TAGS)
    if allowed is None:
        rows = conn.execute(
            "SELECT tags FROM artifact WHERE tags IS NOT NULL"
        ).fetchall()
    elif not allowed:
        rows = []
    else:
        rows = conn.execute(
            f"SELECT tags FROM artifact WHERE tags IS NOT NULL "
            f"AND team_id IN ({_placeholders(allowed)})",
            tuple(allowed),
        ).fetchall()
    for r in rows:
        for tag in json.loads(r["tags"]):
            seen.add(tag)
    ordered = list(_FIXED_TAGS) + sorted(t for t in seen if t not in _FIXED_TAGS)
    return [_value_label(t, _humanize(t)) for t in ordered]


def build_values(
    conn: sqlite3.Connection,
    key: str,
    allowed_team_ids: set[int] | None = None,
) -> dict:
    """Build the tagged autocomplete result for *key*.

    Args:
        conn: An open SQLite connection (``row_factory = Row``).
        key: One of :data:`VALID_KEYS`.
        allowed_team_ids: The caller's read-scope (``readable_team_ids``): a set of
            team ids to restrict team/domain/tag values to, or ``None`` for an
            unrestricted (admin / ``read_all``) caller. An empty set = a scoped user
            with no readable teams (team/domain lists come back empty). The
            non-team-identifying keys (``type``, ``status``, ``date``) ignore it.

    Returns:
        ``{"key", "kind", "values": [{"value","label"}, ...]}``.

    Raises:
        KeyError: If *key* is not a known DSL key (caller maps this to HTTP 422).
    """
    if key not in VALID_KEYS:
        raise KeyError(key)

    if key == "team":
        return {"key": "team", "kind": "enum", "values": _teams(conn, allowed_team_ids)}
    if key == "domain":
        return {
            "key": "domain",
            "kind": "enum",
            "values": _domains(conn, allowed_team_ids),
        }
    if key == "type":
        return {
            "key": "type",
            "kind": "enum",
            "values": [_value_label(t.value, _humanize(t.value)) for t in ArtifactType],
        }
    if key == "status":
        return {
            "key": "status",
            "kind": "enum",
            "values": [_value_label(s.value, _humanize(s.value)) for s in TaskStatus],
        }
    if key == "tag":
        return {"key": "tag", "kind": "free", "values": _tags(conn, allowed_team_ids)}
    # key == "date"
    return {"key": "date", "kind": "date", "values": []}
