"""Filter AST → parameterized SQLite SQL compiler.

Adapted from the vendored SoccerSmartBet Postgres compiler. The vendored
soccer column map, bets/games SELECT, enum-alias normaliser and Postgres
``%(name)s`` / ``ILIKE`` / ``EXTRACT`` machinery were all removed. This
version emits **SQLite** named (``:name``) parameter bindings and uses
``LIKE`` (SQLite ``LIKE`` is case-insensitive for ASCII) for name matching.

There are two filter targets — **tasks** and **artifacts** — with different
joins and different applicable keys. Rather than one fixed ``BASE_SELECT``,
this compiler exposes :func:`compile_where`, which takes the parsed AST plus
an entity context describing how each key maps to SQL for that target. The
``filter_tasks`` / ``filter_artifacts`` functions in ``service.py`` own the
SELECT/JOIN skeletons and embed the compiled WHERE.

Key applicability (api_contract §4):
  * ``type``, ``tag`` — artifacts only; ignored for tasks.
  * ``status``        — tasks only; ignored for artifacts.
  * ``team``, ``domain``, ``date`` — both.

Inapplicable keys are **ignored** (Wave-1 notes); unknown keys never reach the
compiler (the parser raises ``ParseError`` first).
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Callable

from .parser import FilterClause, ParseError

# ---------------------------------------------------------------------------
# Per-key SQL builders
# ---------------------------------------------------------------------------
# A builder takes (clause, param-name prefix, params-dict) and returns a SQL
# fragment, mutating ``params`` with its bindings. ``None`` builder = key is
# inapplicable for this entity and is silently dropped.

Builder = Callable[[FilterClause, str, dict[str, Any]], str]


@dataclass(frozen=True)
class EntityContext:
    """How each DSL key compiles for one filter target (task or artifact).

    Attributes:
        builders: Map of key → SQL-fragment builder. A key absent from this
            map (or mapped to ``None``) is inapplicable and ignored.
    """

    builders: dict[str, Builder | None]


def _values(clause: FilterClause) -> tuple[Any, ...]:
    return clause.values


def _like_escape(value: str) -> str:
    """Escape LIKE special characters so a name matches literally.

    SQLite ``LIKE`` treats ``%``, ``_``, and the chosen escape character as
    special. We use ``\\`` as the escape character (``ESCAPE '\\'``), so we
    must escape backslashes first, then ``%`` and ``_``.
    """
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _name_or_id_builder(name_col: str, id_col: str) -> Builder:
    """Build a matcher for keys whose value may be a name OR an integer id.

    ``team`` / ``domain`` accept either the entity name (case-insensitive,
    via SQLite ``LIKE``) or its integer id. We OR the two interpretations so a
    user can type either. Multiple alternatives in one clause (``in`` op) OR
    together; the ``!`` prefix negates the whole clause.

    ``%`` and ``_`` in names are matched literally via ``ESCAPE '\\'``.
    """

    def build(clause: FilterClause, prefix: str, params: dict[str, Any]) -> str:
        parts: list[str] = []
        for sub_i, raw in enumerate(_values(clause)):
            val = str(raw)
            pname = f"{prefix}_{sub_i}"
            # The parser slug-expands hyphens to spaces for bare words, but our
            # team/domain names may contain literal hyphens (e.g.
            # "signal-processing"). Match both the space form and the
            # hyphenated form so either typed style resolves.
            params[pname] = _like_escape(val)
            name_alts = [f"{name_col} LIKE :{pname} ESCAPE '\\\\'"]
            if " " in val:
                hp = f"{pname}_h"
                params[hp] = _like_escape(val.replace(" ", "-"))
                name_alts.append(f"{name_col} LIKE :{hp} ESCAPE '\\\\'")
            sub = name_alts[0] if len(name_alts) == 1 else "(" + " OR ".join(name_alts) + ")"
            if val.isdigit():
                params[f"{pname}_id"] = int(val)
                sub = f"({sub} OR {id_col} = :{pname}_id)"
            parts.append(sub)
        frag = parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"
        if clause.negated:
            frag = f"NOT ({frag})"
        return frag

    return build


def _exact_builder(col: str) -> Builder:
    """Build an exact-match (``=`` / ``IN``) matcher for enum-ish columns.

    Used for ``type`` and ``status`` (CHECK-constrained enum text columns).
    Values are matched exactly (no LIKE) and case-sensitively — the enum
    tokens are lower/hyphen-cased constants the chip UI supplies verbatim.
    """

    def build(clause: FilterClause, prefix: str, params: dict[str, Any]) -> str:
        pnames: list[str] = []
        for sub_i, raw in enumerate(_values(clause)):
            pname = f"{prefix}_{sub_i}"
            params[pname] = str(raw)
            pnames.append(f":{pname}")
        if len(pnames) == 1:
            frag = f"{col} = {pnames[0]}"
        else:
            frag = f"{col} IN ({', '.join(pnames)})"
        if clause.negated:
            frag = f"NOT ({frag})"
        return frag

    return build


def _tag_builder(tags_col: str) -> Builder:
    """Build a JSON-array membership matcher for ``tag`` (artifacts only).

    ``tags`` is JSON text (a JSON array of strings). We test membership with
    SQLite's ``json_each`` table-valued function via an EXISTS subquery so the
    match is exact-element (not substring). Multiple alternatives in one clause
    OR together.
    """

    def build(clause: FilterClause, prefix: str, params: dict[str, Any]) -> str:
        parts: list[str] = []
        for sub_i, raw in enumerate(_values(clause)):
            pname = f"{prefix}_{sub_i}"
            params[pname] = str(raw)
            parts.append(
                f"EXISTS (SELECT 1 FROM json_each({tags_col}) "
                f"WHERE json_each.value = :{pname})"
            )
        frag = parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"
        if clause.negated:
            frag = f"NOT ({frag})"
        return frag

    return build


def _date_builder(date_cols: tuple[str, ...]) -> Builder:
    """Build a ``date`` matcher.

    DECISION (1D): ``date:YYYY-MM-DD`` matches rows whose lifecycle touches
    that calendar date — for a task, ``started_on <= date AND
    (ended_on IS NULL OR ended_on >= date)`` (i.e. the task was active on that
    day); artifacts have no dates of their own, so ``date`` is inapplicable for
    artifacts and is not wired into the artifact context. ``date_cols`` is the
    (start, end) column pair for the target. Negation flips the whole test.

    A comma-list / ``in`` value is treated as "active on ANY of these dates"
    (OR). This is a deliberately simple, non-history reading — see report
    uncertainties for the alternative (activity via history rows).
    """
    start_col, end_col = date_cols

    def build(clause: FilterClause, prefix: str, params: dict[str, Any]) -> str:
        parts: list[str] = []
        for sub_i, raw in enumerate(_values(clause)):
            pname = f"{prefix}_{sub_i}"
            params[pname] = str(raw)
            parts.append(
                f"({start_col} IS NOT NULL AND {start_col} <= :{pname} "
                f"AND ({end_col} IS NULL OR {end_col} >= :{pname}))"
            )
        frag = parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"
        if clause.negated:
            frag = f"NOT ({frag})"
        return frag

    return build


# ---------------------------------------------------------------------------
# Entity contexts — column expressions assume the joins in service.py
# ---------------------------------------------------------------------------
# Task SELECT joins:  task t -> domain d ON t.domain_id = d.id
#                          -> team m ON d.team_id = m.id
# Artifact SELECT joins: artifact a -> team m ON a.team_id = m.id
#                             LEFT JOIN domain d ON a.domain_id = d.id

TASK_CONTEXT = EntityContext(
    builders={
        "team": _name_or_id_builder("m.name", "m.id"),
        "domain": _name_or_id_builder("d.name", "d.id"),
        "status": _exact_builder("t.status"),
        "date": _date_builder(("t.started_on", "t.ended_on")),
        # artifact-only keys → ignored for tasks
        "type": None,
        "tag": None,
    }
)

ARTIFACT_CONTEXT = EntityContext(
    builders={
        "team": _name_or_id_builder("m.name", "m.id"),
        "domain": _name_or_id_builder("d.name", "d.id"),
        "type": _exact_builder("a.type"),
        "tag": _tag_builder("a.tags"),
        # task-only key → ignored for artifacts
        "status": None,
        # `date` is inapplicable to artifacts (no own dates) → ignored
        "date": None,
    }
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compile_where(
    ast: list[FilterClause],
    context: EntityContext,
) -> tuple[str, dict[str, Any]]:
    """Compile a parsed AST into a SQLite WHERE-body and parameter dict.

    Same-key clauses are AND-combined (api_contract §4: repeated key = AND).
    Distinct keys are also AND-combined. Inapplicable keys (builder is ``None``
    or absent) are dropped. An empty / fully-dropped AST yields ``"1 = 1"``.

    Args:
        ast: Output of :func:`search.parser.parse`.
        context: The :class:`EntityContext` for the target (task / artifact).

    Returns:
        A ``(where_body, params)`` tuple. ``where_body`` is a SQL boolean
        expression (no ``WHERE`` keyword) using ``:name`` placeholders.

    Raises:
        ParseError: If a key has no builder entry at all in the context map
            (should not happen — parser validates keys first).
    """
    params: dict[str, Any] = {}
    if not ast:
        return "1 = 1", params

    # Group clauses by key, preserving first-seen order for deterministic SQL.
    groups: dict[str, list[tuple[int, FilterClause]]] = defaultdict(list)
    key_order: list[str] = []
    for idx, clause in enumerate(ast):
        if clause.key not in groups:
            key_order.append(clause.key)
        groups[clause.key].append((idx, clause))

    and_fragments: list[str] = []
    for key in key_order:
        if key not in context.builders:
            raise ParseError(f"Compiler has no mapping for key: {key!r}")
        builder = context.builders[key]
        if builder is None:
            # Inapplicable key for this entity → ignore (Wave-1 notes).
            continue
        # Repeated key = AND (api_contract §4). Each occurrence is its own
        # fragment; all must hold.
        sub_frags: list[str] = []
        for idx, clause in groups[key]:
            prefix = f"p_{key}_{idx}"
            sub_frags.append(builder(clause, prefix, params))
        if len(sub_frags) == 1:
            and_fragments.append(sub_frags[0])
        else:
            and_fragments.append("(" + " AND ".join(sub_frags) + ")")

    if not and_fragments:
        # Everything was inapplicable (e.g. only `type:` on a task query).
        return "1 = 1", params

    where_body = "\n  AND ".join(and_fragments)
    return where_body, params
