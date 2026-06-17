"""Hand-rolled DSL parser for the AI-Adoption-Tracker search bar.

Adapted from the vendored SoccerSmartBet DSL parser. The grammar machinery
(clause splitting, quoting, comma-lists, negation, hyphen→space slug
expansion) is reused verbatim; only the key set (``VALID_KEYS``) was swapped
to this app's keys and the soccer-specific design notes were rewritten.

Grammar (whitespace-separated tokens)::

    query   ::= clause*
    clause  ::= key ":" value
    key     ::= [a-zA-Z]+          (case-insensitive)
    value   ::= list | negated | plain
    list    ::= token ("," token)*
    negated ::= "!" token
    plain   ::= token
    token   ::= quoted_string | bare_word
    quoted_string ::= '"' [^"]* '"'

Slug expansion: bare-word tokens may contain hyphens which are expanded to
spaces (``signal-processing`` → ``signal processing``). Quoted strings are
passed through verbatim. ISO dates (``YYYY-MM-DD``) are short-circuited so the
hyphens are NOT slug-expanded.

Keys (this app): ``team``, ``domain``, ``type``, ``tag``, ``status``, ``date``.

Design decisions documented at the bottom of this module.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

#: The six DSL keys this app understands (api_contract §4). Lower-cased.
VALID_KEYS: frozenset[str] = frozenset(
    {
        "team",
        "domain",
        "type",
        "tag",
        "status",
        "date",
    }
)

#: Keys whose values are fixed enum tokens (CHECK-constrained columns) matched
#: EXACTLY by the compiler's ``_exact_builder`` (``col = :param``). Their bare
#: tokens must NOT be hyphen→space slug-expanded: the lone multi-word status
#: token ``in-progress`` is stored with its hyphen and is exactly what the chip
#: UI / ``/api/search/values`` autocomplete emits, so expanding it to
#: ``in progress`` would make ``status:in-progress`` match zero rows. Free-text
#: name keys (team/domain) keep slug expansion — the compiler re-adds a
#: hyphenated alternative for them, but the exact-match enum keys do not.
ENUM_KEYS: frozenset[str] = frozenset({"status", "type"})


@dataclass(frozen=True)
class FilterClause:
    """A single parsed filter constraint.

    Attributes:
        key: DSL key (lower-cased), e.g. ``"team"``.
        op: Operator string. For this app only ``"eq"``, ``"in"`` and
            ``"negated"`` are produced (no numeric/date ranges — see notes).
        values: Tuple of resolved string values. For ``"in"`` one or more
            strings; for ``"eq"``/``"negated"`` a 1-tuple.
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

# Matches an ISO date string (YYYY-MM-DD) so its hyphens survive slug expansion.
_RE_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_CLAUSE = re.compile(r'^([a-zA-Z]+):((?:"[^"]*"|[^\s])+)')
_RE_TOKEN_SPLIT = re.compile(r'"[^"]*"|[^,]+')


def _expand_slug(token: str) -> str:
    """Replace hyphens with spaces in bare (unquoted) multi-word slugs.

    ``signal-processing`` → ``signal processing``. ISO dates are short-circuited
    upstream so their hyphens are preserved.
    """
    return token.replace("-", " ")


def _strip_quotes(token: str) -> str:
    """Return a quoted string without its surrounding double quotes."""
    if token.startswith('"') and token.endswith('"') and len(token) >= 2:
        return token[1:-1]
    return token


def _parse_value(raw: str, key: str) -> tuple[str, tuple[Any, ...], bool]:
    """Parse a raw value string into ``(op, values, negated)``.

    Called *after* the key has already been extracted. ``key`` (lower-cased)
    selects bare-word handling: enum keys (:data:`ENUM_KEYS`) keep their literal
    hyphenated token (``in-progress``) for exact matching; all other keys
    slug-expand hyphens to spaces.
    """
    # Enum keys (status/type) are fixed hyphen/lower-cased tokens matched
    # exactly by the compiler — never slug-expand them.
    expand = _expand_slug if key not in ENUM_KEYS else (lambda t: t)

    # Negation prefix: !token
    if raw.startswith("!"):
        raw = raw[1:]
        if raw.startswith('"'):
            token = _strip_quotes(raw)
        elif _RE_ISO_DATE.match(raw):
            token = raw
        else:
            token = expand(raw)
        return ("negated", (token,), True)

    # ISO date short-circuit: YYYY-MM-DD must not be slug-expanded.
    if _RE_ISO_DATE.match(raw):
        return ("eq", (raw,), False)

    # Comma-separated list (may include quoted tokens)
    list_tokens = [t.strip() for t in _RE_TOKEN_SPLIT.findall(raw)]
    if len(list_tokens) > 1 or "," in raw:
        expanded = []
        for tok in list_tokens:
            tok = tok.strip()
            if not tok:
                continue
            expanded.append(_strip_quotes(tok) if tok.startswith('"') else expand(tok))
        return ("in", tuple(expanded), False)

    # Quoted plain value
    if raw.startswith('"'):
        return ("eq", (_strip_quotes(raw),), False)

    # Plain bare word
    return ("eq", (expand(raw),), False)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse(dsl: str) -> list[FilterClause]:
    """Parse a DSL string into a list of :class:`FilterClause` objects.

    An empty or whitespace-only string returns ``[]`` (match-everything).

    Repeated keys are allowed; each occurrence produces a separate clause. The
    compiler AND-combines same-key clauses (api_contract §4: repeated key = AND).

    Args:
        dsl: Raw filter string, e.g. ``"team:radar domain:signal-processing"``.

    Returns:
        Ordered list of parsed filter clauses.

    Raises:
        ParseError: If an unknown key is encountered or a token is malformed.
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
            # No "key:" prefix — surface a clear error rather than silently
            # dropping the fragment.
            space_idx = remaining.find(" ")
            bad_token = remaining if space_idx == -1 else remaining[:space_idx]
            if ":" in bad_token:
                bad_key = bad_token.split(":")[0].lower()
                if bad_key not in VALID_KEYS:
                    raise ParseError(f"Unknown filter key: {bad_key!r}")
            raise ParseError(f"Malformed DSL token: {bad_token!r}")

        raw_key = m.group(1).lower()
        raw_value = m.group(2)
        remaining = remaining[m.end():]

        if raw_key not in VALID_KEYS:
            raise ParseError(f"Unknown filter key: {raw_key!r}")

        op, values, negated = _parse_value(raw_value, raw_key)
        clauses.append(FilterClause(key=raw_key, op=op, values=values, negated=negated))

    return clauses


# ---------------------------------------------------------------------------
# Design decisions (this app — see also the agent report uncertainties)
# ---------------------------------------------------------------------------
# 1. Keys: team, domain, type, tag, status, date (api_contract §4). The soccer
#    keys (league/stake/odds/outcome/bettor/prediction/result/month) were
#    removed.
#
# 2. Repeated keys: AND within a key group (api_contract §4 / Wave-1 notes:
#    "repeated key = AND"). This diverges from the vendored parser's default OR.
#    Implemented compiler-side. A comma-list (``tag:a,tag:b`` i.e. ``tag:a,b``)
#    is left as IN (OR) — a single clause listing alternatives — distinct from
#    two separate ``tag:a tag:b`` clauses which AND.
#
# 3. No numeric/date *ranges*. This app has no numeric DSL key, and `date` is a
#    plain ISO-date eq (semantics decided in the compiler). The vendored
#    range-operator and between branches were removed.
#
# 4. Slug expansion: bare hyphens expand to spaces (``signal-processing`` →
#    ``signal processing``) so names with spaces are typeable without quotes.
#    Quoted values are verbatim. ISO dates keep their hyphens.
#
# 5. Case folding: keys are lower-cased. String values are NOT lower-cased here;
#    case-insensitive name matching is done in the compiler's SQL.
