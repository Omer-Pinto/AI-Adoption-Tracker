"""Filter AST → parameterized SQL compiler.

Takes the list of :class:`.parser.FilterClause`
objects produced by the parser and emits a SQL WHERE clause using **named
psycopg3 ``%(name)s`` parameter binding only** — never f-string interpolation
of user values.

Base SELECT (owned by this module; Wave 12 routes call ``compile()`` and embed
the result)::

    SELECT b.bet_id, b.bettor, b.prediction, b.stake, b.odds, b.result,
           b.pnl,
           g.game_id, g.home_team, g.away_team, g.match_date, g.kickoff_time,
           g.league, g.outcome, g.home_score, g.away_score
    FROM bets b
    JOIN games g ON b.game_id = g.game_id
    WHERE <compiled_where>
    ORDER BY g.match_date DESC, g.kickoff_time DESC
    LIMIT %(row_cap)s

Note: ``bets`` has no ``placed_at`` column (as of schema v1).  If a future DDL
adds it, restore it here per CLAUDE.md's live-DDL approval policy.

Note: ``games.kickoff_time`` is ``TIME NOT NULL`` (time-of-day only).
      ``games.match_date`` is ``DATE NOT NULL`` (ISR-local match date).
      Both columns are selected and ORDER BY uses both for deterministic sort.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from .parser import FilterClause, ParseError

# ---------------------------------------------------------------------------
# Outcome / prediction / result value-alias normalisation
# ---------------------------------------------------------------------------

#: Keys whose values are single-char CHECK-constrained ('1'|'x'|'2').
_ENUM_KEYS: frozenset[str] = frozenset({"outcome", "prediction", "result"})

#: Alias → canonical mapping (case-insensitive lookup applied in normaliser).
_ENUM_ALIASES: dict[str, str] = {
    "home": "1",
    "home_win": "1",
    "1": "1",
    "draw": "x",
    "tie": "x",
    "x": "x",
    "away": "2",
    "away_win": "2",
    "2": "2",
}

_ENUM_CANONICAL_SET: str = "'home'/'home_win'/'1', 'draw'/'tie'/'x', 'away'/'away_win'/'2'"


def _normalise_enum_value(key: str, raw: str) -> str:
    """Map a user-supplied alias to its canonical single-char value.

    Args:
        key: DSL key (already validated as an enum key).
        raw: Raw string value from the parsed clause.

    Returns:
        Canonical value: ``'1'``, ``'x'``, or ``'2'``.

    Raises:
        ParseError: If *raw* is not a recognised alias.
    """
    canonical = _ENUM_ALIASES.get(raw.lower())
    if canonical is None:
        raise ParseError(
            f"Invalid value {raw!r} for {key!r}. "
            f"Accepted aliases: {_ENUM_CANONICAL_SET}. "
            f"Canonical values: '1' (home), 'x' (draw), '2' (away)."
        )
    return canonical


# ---------------------------------------------------------------------------
# Public SQL constant (Wave 12 routes embed this)
# ---------------------------------------------------------------------------

BASE_SELECT: str = """
SELECT
    b.bet_id,
    b.bettor,
    b.prediction,
    b.stake,
    b.odds,
    b.result,
    b.pnl,
    g.game_id,
    g.home_team,
    g.away_team,
    g.match_date,
    g.kickoff_time,
    g.league,
    g.outcome,
    g.home_score,
    g.away_score
FROM bets b
JOIN games g ON b.game_id = g.game_id
""".strip()

_ORDER_LIMIT: str = "ORDER BY g.match_date DESC, g.kickoff_time DESC\nLIMIT %(row_cap)s"

# ---------------------------------------------------------------------------
# Column mapping
# ---------------------------------------------------------------------------

# Keys that map to a simple column expression (used for eq / in / range ops).
_COLUMN_MAP: dict[str, str] = {
    "league": "g.league",
    "stake": "b.stake",
    "odds": "b.odds",
    "outcome": "g.outcome",
    "bettor": "b.bettor",
    "prediction": "b.prediction",
    "result": "b.result",
}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _param_name(base: str, idx: int, sub: int | None = None) -> str:
    """Generate a unique, safe parameter name.

    Args:
        base: DSL key name (already validated — alphanumeric only).
        idx: Clause position in the AST (0-based).
        sub: Sub-index within a list value, or ``None`` for scalar.

    Returns:
        A string safe for use as a psycopg3 ``%(name)s`` placeholder.
    """
    if sub is None:
        return f"p_{base}_{idx}"
    return f"p_{base}_{idx}_{sub}"


def _compile_clause(
    clause: FilterClause,
    idx: int,
    params: dict[str, Any],
) -> str:
    """Compile a single :class:`FilterClause` to a SQL fragment.

    All user values are placed into *params* — never interpolated into SQL.

    Args:
        clause: The parsed clause to compile.
        idx: Position index used to generate unique parameter names.
        params: Mutable dict that receives the parameter bindings.

    Returns:
        A SQL fragment (without leading/trailing whitespace) to be joined with
        AND.

    Raises:
        ParseError: If the key is not supported by the compiler (should not
            happen after parser validation, but kept as a safety net).
    """
    key = clause.key

    # -----------------------------------------------------------------------
    # Special keys with custom SQL shapes
    # -----------------------------------------------------------------------

    if key == "team":
        return _compile_team(clause, idx, params)

    if key == "date":
        return _compile_date(clause, idx, params)

    if key == "month":
        return _compile_month(clause, idx, params)

    # -----------------------------------------------------------------------
    # Generic column-mapped keys
    # -----------------------------------------------------------------------

    col = _COLUMN_MAP.get(key)
    if col is None:
        raise ParseError(f"Compiler has no mapping for key: {key!r}")

    fragment = _compile_generic(col, clause, idx, params)
    if clause.negated:
        fragment = f"NOT ({fragment})"
    return fragment


def _compile_generic(
    col: str,
    clause: FilterClause,
    idx: int,
    params: dict[str, Any],
) -> str:
    """Compile a generic (non-special) clause for a direct column expression.

    For enum keys (outcome, prediction, result) values are normalised through
    the alias map before binding and exact-eq (not ILIKE) is emitted.
    """
    op = clause.op
    key = clause.key
    values = clause.values
    is_enum = key in _ENUM_KEYS
    is_text = _is_text_key(key)

    if op == "eq":
        pname = _param_name(key, idx)
        raw_v = str(values[0])
        if is_enum:
            bound = _normalise_enum_value(key, raw_v)
        elif key in _LOWERCASE_KEYS:
            bound = raw_v.lower()
        else:
            bound = raw_v
        params[pname] = bound
        if is_text:
            return f"{col} ILIKE %({pname})s"
        return f"{col} = %({pname})s"

    if op == "negated":
        pname = _param_name(key, idx)
        raw_v = str(values[0])
        if is_enum:
            bound = _normalise_enum_value(key, raw_v)
        elif key in _LOWERCASE_KEYS:
            bound = raw_v.lower()
        else:
            bound = raw_v
        params[pname] = bound
        if is_text:
            return f"NOT ({col} ILIKE %({pname})s)"
        return f"NOT ({col} = %({pname})s)"

    if op == "in":
        frags = []
        for sub_i, val in enumerate(values):
            pname = _param_name(key, idx, sub_i)
            raw_v = str(val)
            if is_enum:
                bound = _normalise_enum_value(key, raw_v)
            elif key in _LOWERCASE_KEYS:
                bound = raw_v.lower()
            else:
                bound = raw_v
            params[pname] = bound
            frags.append(f"%({pname})s")
        in_list = ", ".join(frags)
        return f"{col} IN ({in_list})"

    if op == "between":
        lo_name = _param_name(clause.key, idx, 0)
        hi_name = _param_name(clause.key, idx, 1)
        params[lo_name] = values[0]
        params[hi_name] = values[1]
        return f"{col} BETWEEN %({lo_name})s AND %({hi_name})s"

    if op == "gt":
        pname = _param_name(clause.key, idx)
        params[pname] = values[0]
        return f"{col} > %({pname})s"

    if op == "gte":
        pname = _param_name(clause.key, idx)
        params[pname] = values[0]
        return f"{col} >= %({pname})s"

    if op == "lt":
        pname = _param_name(clause.key, idx)
        params[pname] = values[0]
        return f"{col} < %({pname})s"

    if op == "lte":
        pname = _param_name(clause.key, idx)
        params[pname] = values[0]
        return f"{col} <= %({pname})s"

    raise ParseError(f"Unknown op: {op!r}")  # pragma: no cover


def _is_text_key(key: str) -> bool:
    """Return True for keys whose column values are free-text (use ILIKE).

    Enum keys (outcome, prediction, result) use exact-eq despite being text,
    because their values are single-char CHECK-constrained ('1'|'x'|'2').
    """
    return key in {"league", "bettor"}


#: Keys whose values should be lower-cased before binding to normalise
#: case-variant user input (e.g. ``bettor:User`` → ``'user'``).
_LOWERCASE_KEYS: frozenset[str] = frozenset({"bettor"})


def _compile_team(
    clause: FilterClause,
    idx: int,
    params: dict[str, Any],
) -> str:
    """Compile ``team`` clause to a home-or-away ILIKE pattern.

    Negated: wraps in NOT (...).
    List values: each team becomes its own home-or-away fragment, joined OR.
    """
    op = clause.op
    values = clause.values

    def _team_pair(val: str, pname: str) -> str:
        params[pname] = f"%{val}%"
        return f"(g.home_team ILIKE %({pname})s OR g.away_team ILIKE %({pname})s)"

    if op in {"eq", "negated"}:
        pname = _param_name("team", idx)
        frag = _team_pair(values[0], pname)
        if op == "negated" or clause.negated:
            frag = f"NOT {frag}"
        return frag

    if op == "in":
        sub_frags = []
        for sub_i, val in enumerate(values):
            pname = _param_name("team", idx, sub_i)
            sub_frags.append(_team_pair(val, pname))
        combined = " OR ".join(sub_frags)
        result = f"({combined})" if len(sub_frags) > 1 else combined
        if clause.negated:
            result = f"NOT ({result})"
        return result

    raise ParseError(f"Operator {op!r} is not supported for 'team'")


def _compile_date(
    clause: FilterClause,
    idx: int,
    params: dict[str, Any],
) -> str:
    """Compile ``date`` clause.

    ``games.match_date`` is a ``DATE NOT NULL`` column already in ISR-local
    calendar — no timezone conversion required.  Compare directly.
    """
    col = "g.match_date"
    frag = _compile_generic(col, clause, idx, params)
    if clause.negated and clause.op not in {"negated"}:
        frag = f"NOT ({frag})"
    return frag


def _compile_month(
    clause: FilterClause,
    idx: int,
    params: dict[str, Any],
) -> str:
    """Compile ``month`` clause.

    Accepts ``YYYY-MM`` (e.g. ``2026-04``) or ``MM`` (e.g. ``04``).

    The parser now returns ``("eq", ("2026-04",), False)`` for YYYY-MM values
    (ISO year-month short-circuit).  For a bare month number the op is ``eq``
    with a single numeric string (e.g. ``"04"``).

    ISR-aware: ``games.kickoff_time`` is ``TIME NOT NULL`` and
    ``games.match_date`` is ``DATE NOT NULL``.  PostgreSQL's ``DATE + TIME``
    arithmetic yields a ``TIMESTAMP`` (documented), which we then cast to
    ``TIMESTAMPTZ AT TIME ZONE 'Asia/Jerusalem'`` for correct ISR-local
    month/year extraction.
    """
    op = clause.op
    values = clause.values
    tz_expr = "(g.match_date + g.kickoff_time)::TIMESTAMP AT TIME ZONE 'Asia/Jerusalem'"

    # YYYY-MM eq: parser emits ("eq", ("2026-04",), False) via ISO short-circuit.
    if op == "eq" and len(values) == 1 and isinstance(values[0], str) and "-" in values[0]:
        year_str, mon_str = values[0].split("-", 1)
        year_val, mon_val = int(year_str), int(mon_str)
        year_pname = _param_name("month_year", idx)
        mon_pname = _param_name("month_mon", idx)
        params[year_pname] = year_val
        params[mon_pname] = mon_val
        frag = (
            f"(EXTRACT(YEAR FROM {tz_expr}) = %({year_pname})s"
            f" AND EXTRACT(MONTH FROM {tz_expr}) = %({mon_pname})s)"
        )
    else:
        # Bare MM: eq / negated with a single numeric value.
        mon_pname = _param_name("month_mon", idx)
        params[mon_pname] = int(float(values[0]))
        frag = f"EXTRACT(MONTH FROM {tz_expr}) = %({mon_pname})s"

    if clause.negated or op == "negated":
        frag = f"NOT ({frag})"
    return frag


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compile(  # noqa: A001  (shadows built-in; intentional for readability)
    ast: list[FilterClause],
    row_cap: int = 2000,
) -> tuple[str, dict[str, Any]]:
    """Compile a parsed filter AST into a full SQL query and parameter dict.

    Args:
        ast: Output of :func:`.parser.parse`.
        row_cap: Maximum rows to return.  Hard cap is 2000; Wave 12 routes
            may pass a stricter value (e.g. 500 for AI-insights endpoints).

    Returns:
        A ``(sql, params)`` tuple.  ``sql`` is the complete ready-to-execute
        query string using ``%(name)s`` placeholders.  ``params`` is the
        corresponding parameter dict.
    """
    row_cap = min(row_cap, 2000)
    params: dict[str, Any] = {"row_cap": row_cap}

    if not ast:
        where_clause = "TRUE"
    else:
        # Group clauses by key, preserving insertion order.
        # Clauses with the same key are combined with OR inside parentheses,
        # EXCEPT when all clauses in the group are inequality-range operators
        # (gt / gte / lt / lte).  Range operators for the same key represent
        # bounds of a compound range (e.g. date:>=2026-04-20 date:<=2026-04-23)
        # and MUST be AND-combined so both bounds are enforced simultaneously.
        # Using OR would produce a tautology (any date satisfies one of the two
        # half-open conditions), returning the full unfiltered result set.
        _RANGE_OPS: frozenset[str] = frozenset({"gt", "gte", "lt", "lte"})

        groups: dict[str, list[tuple[int, FilterClause]]] = defaultdict(list)
        # Use a list to preserve the first-seen key order for deterministic SQL.
        key_order: list[str] = []
        for idx, clause in enumerate(ast):
            if clause.key not in groups:
                key_order.append(clause.key)
            groups[clause.key].append((idx, clause))

        and_fragments: list[str] = []
        for key in key_order:
            group = groups[key]
            if len(group) == 1:
                idx, clause = group[0]
                and_fragments.append(_compile_clause(clause, idx, params))
            else:
                # If every clause in this key-group uses a range operator,
                # AND-combine them (range bounds must all hold simultaneously).
                # Otherwise fall back to OR-combine (e.g. league:pl league:bundesliga).
                all_range = all(clause.op in _RANGE_OPS for _, clause in group)
                if all_range:
                    range_parts: list[str] = []
                    for idx, clause in group:
                        range_parts.append(_compile_clause(clause, idx, params))
                    and_fragments.append("(" + " AND ".join(range_parts) + ")")
                else:
                    or_parts: list[str] = []
                    for idx, clause in group:
                        or_parts.append(_compile_clause(clause, idx, params))
                    and_fragments.append("(" + " OR ".join(or_parts) + ")")

        where_clause = "\n  AND ".join(and_fragments)

    sql = f"{BASE_SELECT}\nWHERE {where_clause}\n{_ORDER_LIMIT}"
    return sql, params
