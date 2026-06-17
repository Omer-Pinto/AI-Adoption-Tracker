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


def _teams(conn: sqlite3.Connection) -> list[dict[str, str]]:
    rows = conn.execute("SELECT name FROM team ORDER BY name").fetchall()
    return [_value_label(r["name"], r["name"]) for r in rows]


def _domains(conn: sqlite3.Connection) -> list[dict[str, str]]:
    rows = conn.execute("SELECT name FROM domain ORDER BY name").fetchall()
    return [_value_label(r["name"], r["name"]) for r in rows]


def _tags(conn: sqlite3.Connection) -> list[dict[str, str]]:
    seen: set[str] = set(_FIXED_TAGS)
    rows = conn.execute("SELECT tags FROM artifact WHERE tags IS NOT NULL").fetchall()
    for r in rows:
        for tag in json.loads(r["tags"]):
            seen.add(tag)
    ordered = list(_FIXED_TAGS) + sorted(t for t in seen if t not in _FIXED_TAGS)
    return [_value_label(t, _humanize(t)) for t in ordered]


def build_values(conn: sqlite3.Connection, key: str) -> dict:
    """Build the tagged autocomplete result for *key*.

    Args:
        conn: An open SQLite connection (``row_factory = Row``).
        key: One of :data:`VALID_KEYS`.

    Returns:
        ``{"key", "kind", "values": [{"value","label"}, ...]}``.

    Raises:
        KeyError: If *key* is not a known DSL key (caller maps this to HTTP 422).
    """
    if key not in VALID_KEYS:
        raise KeyError(key)

    if key == "team":
        return {"key": "team", "kind": "enum", "values": _teams(conn)}
    if key == "domain":
        return {"key": "domain", "kind": "enum", "values": _domains(conn)}
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
        return {"key": "tag", "kind": "free", "values": _tags(conn)}
    # key == "date"
    return {"key": "date", "kind": "date", "values": []}
