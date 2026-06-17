"""Hand-rolled DSL parser for the search query engine (vendored adaptation base).

Grammar (whitespace-separated tokens)::

    query   ::= clause*
    clause  ::= key ":" value
    key     ::= [a-zA-Z]+          (case-insensitive)
    value   ::= range | list | negated | plain
    range   ::= (">" | "<" | ">=" | "<=") number
              | number "-" number  (inclusive-inclusive)
    list    ::= token ("," token)*
    negated ::= "!" token
    plain   ::= token
    token   ::= quoted_string | bare_word
    quoted_string ::= '"' [^"]* '"'

Slug expansion: bare-word tokens may contain hyphens which are expanded to
spaces (``real-madrid`` → ``real madrid``).  Quoted strings are passed
through verbatim.

Design decisions documented at the bottom of this module.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

VALID_KEYS: frozenset[str] = frozenset(
    {
        "league",
        "team",
        "date",
        "month",
        "stake",
        "odds",
        "outcome",
        "bettor",
        "prediction",
        "result",
    }
)


@dataclass(frozen=True)
class FilterClause:
    """A single parsed filter constraint.

    Attributes:
        key: DSL key (lower-cased), e.g. ``"league"``.
        op: Operator string: ``"eq"``, ``"gt"``, ``"gte"``, ``"lt"``,
            ``"lte"``, ``"between"``, ``"in"``, ``"negated"``.
        values: Tuple of resolved string/numeric values.  For ``"between"``,
            always ``(low, high)``.  For ``"gt"``/``"gte"``/``"lt"``/
            ``"lte"``, always a 1-tuple.  For ``"in"``/``"eq"``, one or more
            strings.  For ``"negated"``, a 1-tuple.
        negated: ``True`` when the ``!`` prefix was used.
    """

    key: str
    op: str
    values: tuple[Any, ...]
    negated: bool = False


class ParseError(ValueError):
    """Raised for unknown keys or malformed token sequences."""


# ---------------------------------------------------------------------------
# Internal regex helpers (individual tokens only, NOT the whole grammar)
# ---------------------------------------------------------------------------

_RE_RANGE_OP = re.compile(r"^(>=|<=|>|<)(.+)$")
_RE_NUMERIC = re.compile(r"^-?\d+(\.\d+)?$")
# Matches an ISO date string (YYYY-MM-DD) for date-key range support
_RE_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Matches a YYYY-MM year-month string (e.g. 2026-04)
_RE_ISO_YEAR_MONTH = re.compile(r"^\d{4}-\d{2}$")
_RE_CLAUSE = re.compile(r'^([a-zA-Z]+):((?:"[^"]*"|[^\s])+)')
_RE_TOKEN_SPLIT = re.compile(r'"[^"]*"|[^,]+')


def _is_numeric(s: str) -> bool:
    return bool(_RE_NUMERIC.match(s))


def _expand_slug(token: str) -> str:
    """Replace hyphens with spaces in bare (unquoted) multi-word slugs.

    ``real-madrid`` → ``real madrid``.  Numbers with hyphens (range syntax)
    never reach this function because the range branch is checked first.
    """
    return token.replace("-", " ")


def _strip_quotes(token: str) -> str:
    """Return a quoted string without its surrounding double quotes."""
    if token.startswith('"') and token.endswith('"') and len(token) >= 2:
        return token[1:-1]
    return token


def _parse_value(raw: str) -> tuple[str, tuple[Any, ...], bool]:
    """Parse a raw value string into ``(op, values, negated)``.

    This helper is called *after* the key has already been extracted.

    Raises:
        ParseError: On structurally invalid range syntax.
    """
    # Negation prefix
    negated = False
    if raw.startswith("!"):
        negated = True
        raw = raw[1:]
        token = _strip_quotes(raw) if raw.startswith('"') else _expand_slug(raw)
        return ("negated", (token,), True)

    # Range with operator prefix: >2.5  <1.5  >=3  <=10  >=2026-04-01
    m = _RE_RANGE_OP.match(raw)
    if m:
        op_sym, val_str = m.group(1), m.group(2)
        op_map = {">": "gt", "<": "lt", ">=": "gte", "<=": "lte"}
        if _is_numeric(val_str):
            return (op_map[op_sym], (float(val_str),), False)
        if _RE_ISO_DATE.match(val_str):
            # Date strings are kept as strings; compiler handles SQL date casting.
            return (op_map[op_sym], (val_str,), False)
        raise ParseError(f"Expected a number or date after '{op_sym}', got: {val_str!r}")

    # ISO date short-circuit: YYYY-MM-DD must not be slug-expanded (hyphen→space).
    # This must run BEFORE the numeric-range split so "2026-04-15" is not parsed
    # as a between(2026, 4) followed by leftover "-15".
    if _RE_ISO_DATE.match(raw):
        return ("eq", (raw,), False)

    # ISO year-month short-circuit: YYYY-MM must remain intact for the compiler.
    if _RE_ISO_YEAR_MONTH.match(raw):
        return ("eq", (raw,), False)

    # Comma-separated list (may include quoted tokens)
    list_tokens = [t.strip() for t in _RE_TOKEN_SPLIT.findall(raw)]
    if len(list_tokens) > 1 or "," in raw:
        expanded = []
        for tok in list_tokens:
            tok = tok.strip()
            if not tok:
                continue
            expanded.append(_strip_quotes(tok) if tok.startswith('"') else _expand_slug(tok))
        return ("in", tuple(expanded), False)

    # Quoted plain value
    if raw.startswith('"'):
        return ("eq", (_strip_quotes(raw),), False)

    # Check for bare-word numeric range: 1.5-3.0
    # Must not look like a pure negative number — require two number-like parts.
    parts = raw.split("-")
    if len(parts) == 2 and _is_numeric(parts[0]) and _is_numeric(parts[1]):
        low, high = float(parts[0]), float(parts[1])
        return ("between", (low, high), False)

    # Plain bare word
    return ("eq", (_expand_slug(raw),), False)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse(dsl: str) -> list[FilterClause]:
    """Parse a DSL string into a list of :class:`FilterClause` objects.

    An empty or whitespace-only string returns ``[]`` (match-everything).

    Repeated keys are allowed; each occurrence produces a separate clause.
    The compiler groups same-key clauses with OR by default so both
    ``league:pl league:bundesliga`` and ``league:pl,bundesliga`` are
    semantically equivalent (both return games from either league).
    Exception: when all same-key clauses use inequality-range operators
    (gt / gte / lt / lte), the compiler AND-combines them so that
    ``date:>=2026-04-20 date:<=2026-04-23`` produces a bounded range
    rather than an OR-tautology that returns all rows.

    Args:
        dsl: Raw filter string from the user, e.g.
            ``"league:pl team:arsenal odds:>2.0"``.

    Returns:
        Ordered list of parsed filter clauses.

    Raises:
        ParseError: If an unknown key is encountered or a range value is not
            numeric.
    """
    dsl = dsl.strip()
    if not dsl:
        return []

    clauses: list[FilterClause] = []
    remaining = dsl

    while remaining:
        remaining = remaining.lstrip()
        if not remaining:
            break

        m = _RE_CLAUSE.match(remaining)
        if not m:
            # Bare word with no "key:" prefix — skip unknown fragments
            # by consuming until next whitespace so the rest can be parsed.
            space_idx = remaining.find(" ")
            bad_token = remaining if space_idx == -1 else remaining[:space_idx]
            # If it contains a colon it's a malformed clause, not a bare word.
            if ":" in bad_token:
                bad_key = bad_token.split(":")[0].lower()
                if bad_key not in VALID_KEYS:
                    raise ParseError(f"Unknown filter key: {bad_key!r}")
            raise ParseError(f"Malformed DSL token: {bad_token!r}")

        raw_key = m.group(1).lower()
        raw_value = m.group(2)
        consumed = m.end()
        remaining = remaining[consumed:]

        if raw_key not in VALID_KEYS:
            raise ParseError(f"Unknown filter key: {raw_key!r}")

        op, values, negated = _parse_value(raw_value)
        clauses.append(FilterClause(key=raw_key, op=op, values=values, negated=negated))

    return clauses


# ---------------------------------------------------------------------------
# Design decisions
# ---------------------------------------------------------------------------
# 1. Repeated keys: OR semantics within each key group by default.
#    ``league:pl league:bundesliga`` compiles to
#    ``(g.league ILIKE %(p0)s OR g.league ILIKE %(p1)s)`` — equivalent to
#    the comma-list form ``league:pl,bundesliga``.  Both forms are accepted and produce
#    the same result set.  Distinct keys are AND-combined across groups.
#    Exception (compiler-side): when all same-key clauses use inequality-range ops
#    (gt / gte / lt / lte), the compiler AND-combines them instead of OR-combining,
#    so that ``date:>=2026-04-20 date:<=2026-04-23`` produces a bounded date range.
#
# 2. Multi-word team slugs: bare hyphens expand to spaces
#    (``real-madrid`` → ``real madrid``).  Quoted values are verbatim.
#    The ``team`` compiler clause does a case-insensitive ILIKE match so
#    capitalisation in the slug does not matter.
#
# 3. Date ranges vs. plain dates: ``date:2026-04-15`` is a plain eq.
#    ``date:>=2026-04-01`` is a gte range.  Both parse correctly because
#    the range-operator branch fires before the hyphen-split branch.
#
# 4. ``month`` value: expected as ``2026-04`` (YYYY-MM) or ``04`` (bare month
#    number).  The compiler handles the SQL extraction.
#
# 5. Case folding: keys are lower-cased; string values are NOT lower-cased so
#    the compiler can use ILIKE for case-insensitive column matches where
#    appropriate.
