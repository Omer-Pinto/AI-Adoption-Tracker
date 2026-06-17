"""Filter-values endpoint — GET /api/filter/values?key=<dsl_key>.

Returns the set of valid values (or numeric/date range) for each DSL filter
key so the frontend can drive real autocomplete rather than free-text inputs.

Routes:
  GET /api/filter/values?key=<dsl_key>[&fresh=1]

Response shapes:
  Enum  keys → {"key": str, "kind": "enum",    "values": list[str]}
  Numeric   → {"key": str, "kind": "numeric", "min": float, "max": float}
  Date      → {"key": str, "kind": "date",    "min": str,   "max": str}

Design decisions:
- In-process 60-second TTL cache per key: distinct-value queries are called
  on every keypress in the autocomplete widget and the underlying data changes
  at most once per day.  No external cache dependency (Redis not needed).
- Cache bypass: ?fresh=1 forces a new DB query and refills the cache entry.
- Enum canonical labels for outcome/prediction/result: the compiler maps any
  accepted alias to a single-char DB value ('1'/'x'/'2').  We expose the
  human-readable aliases ("home win", "draw", "away win") as well as the
  raw DB symbols so both forms work in the DSL.
- Key validation uses parser.VALID_KEYS directly so this endpoint stays in
  sync with the parser automatically.
"""
from __future__ import annotations

import logging
import time as _time
from typing import Annotated, Union

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict

# TODO(Wave 1D): provide get_cursor from the app's SQLite db layer (db.py).
from .parser import VALID_KEYS

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------


class FilterValuesEnum(BaseModel):
    """Response for enum-typed DSL keys (list of distinct string values).

    Attributes:
        key: The DSL key name.
        kind: Always ``"enum"``.
        values: Sorted list of distinct values accepted by this key.
    """

    model_config = ConfigDict(frozen=True)

    key: str
    kind: str = "enum"
    values: list[str]


class FilterValuesNumeric(BaseModel):
    """Response for numeric-ranged DSL keys (stake, odds).

    Attributes:
        key: The DSL key name.
        kind: Always ``"numeric"``.
        min: Minimum value present in the DB.
        max: Maximum value present in the DB.
    """

    model_config = ConfigDict(frozen=True)

    key: str
    kind: str = "numeric"
    min: float
    max: float


class FilterValuesDate(BaseModel):
    """Response for date-ranged DSL keys (date).

    Attributes:
        key: The DSL key name.
        kind: Always ``"date"``.
        min: Earliest date as ``"YYYY-MM-DD"``.
        max: Latest date as ``"YYYY-MM-DD"``.
    """

    model_config = ConfigDict(frozen=True)

    key: str
    kind: str = "date"
    min: str
    max: str


FilterValuesResponse = Union[FilterValuesEnum, FilterValuesNumeric, FilterValuesDate]

# ---------------------------------------------------------------------------
# Canonical enum labels
# ---------------------------------------------------------------------------

# Human-readable aliases that the compiler already accepts, in display order.
# Exposed so the autocomplete widget shows readable labels; the DSL also
# accepts the single-char canonical forms ('1', 'x', '2').
_ENUM_LABELS: list[str] = [
    "home",
    "home_win",
    "1",
    "draw",
    "tie",
    "x",
    "away",
    "away_win",
    "2",
]

# ---------------------------------------------------------------------------
# In-process TTL cache
# ---------------------------------------------------------------------------

_CACHE_TTL_SECONDS: float = 60.0

# key → (payload_dict, cached_at_monotonic)
_cache: dict[str, tuple[dict, float]] = {}


def _cache_get(key: str) -> dict | None:
    """Return cached payload for *key* if still within TTL, else None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    payload, cached_at = entry
    if (_time.monotonic() - cached_at) < _CACHE_TTL_SECONDS:
        return payload
    return None


def _cache_set(key: str, payload: dict) -> None:
    """Store *payload* for *key* with the current monotonic timestamp."""
    _cache[key] = (payload, _time.monotonic())


# ---------------------------------------------------------------------------
# Per-key DB query functions (each returns a plain dict ready to serialise)
# ---------------------------------------------------------------------------


def _fetch_league() -> dict:
    sql = """
        SELECT DISTINCT league
        FROM games
        WHERE league IS NOT NULL
        ORDER BY league
    """
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return {"key": "league", "kind": "enum", "values": [r[0] for r in rows]}


def _fetch_team() -> dict:
    sql = """
        SELECT DISTINCT team
        FROM (
            SELECT home_team AS team FROM games
            UNION
            SELECT away_team FROM games
        ) t
        WHERE team IS NOT NULL
        ORDER BY team
    """
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return {"key": "team", "kind": "enum", "values": [r[0] for r in rows]}


def _fetch_bettor() -> dict:
    sql = """
        SELECT DISTINCT bettor
        FROM bets
        WHERE bettor IS NOT NULL
        ORDER BY bettor
    """
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return {"key": "bettor", "kind": "enum", "values": [r[0] for r in rows]}


def _fetch_enum_key(dsl_key: str, col_expr: str) -> dict:
    """Fetch distinct raw DB values for outcome/prediction/result.

    We return the canonical alias labels (human-readable) rather than the
    raw single-char DB values ('1'/'x'/'2'), because that is what a user
    types in the filter bar.  The compiler normalises them back to '1'/'x'/'2'
    before hitting the DB.
    """
    sql = f"""
        SELECT DISTINCT {col_expr}
        FROM {_ENUM_TABLE[dsl_key]}
        WHERE {col_expr} IS NOT NULL
        ORDER BY {col_expr}
    """  # col_expr is a hard-coded internal constant — not user-supplied
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        cur.fetchall()  # discard raw '1'/'x'/'2' — we return canonical labels
    # Expose all canonical aliases in a fixed display order.
    return {"key": dsl_key, "kind": "enum", "values": _ENUM_LABELS}


_ENUM_TABLE: dict[str, str] = {
    "outcome": "games",
    "prediction": "bets",
    "result": "bets",
}

_ENUM_COL: dict[str, str] = {
    "outcome": "outcome",
    "prediction": "prediction",
    "result": "result",
}


def _fetch_outcome() -> dict:
    return {"key": "outcome", "kind": "enum", "values": _ENUM_LABELS}


def _fetch_prediction() -> dict:
    return {"key": "prediction", "kind": "enum", "values": _ENUM_LABELS}


def _fetch_result() -> dict:
    return {"key": "result", "kind": "enum", "values": _ENUM_LABELS}


def _fetch_stake() -> dict:
    sql = "SELECT MIN(stake), MAX(stake) FROM bets"
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        row = cur.fetchone()
    if row is None or row[0] is None:
        return {"key": "stake", "kind": "numeric", "min": 0.0, "max": 0.0}
    return {"key": "stake", "kind": "numeric", "min": float(row[0]), "max": float(row[1])}


def _fetch_odds() -> dict:
    sql = "SELECT MIN(odds), MAX(odds) FROM bets"
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        row = cur.fetchone()
    if row is None or row[0] is None:
        return {"key": "odds", "kind": "numeric", "min": 0.0, "max": 0.0}
    return {"key": "odds", "kind": "numeric", "min": float(row[0]), "max": float(row[1])}


def _fetch_date() -> dict:
    sql = "SELECT MIN(match_date), MAX(match_date) FROM games"
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        row = cur.fetchone()
    if row is None or row[0] is None:
        return {"key": "date", "kind": "date", "min": "", "max": ""}
    return {
        "key": "date",
        "kind": "date",
        "min": row[0].isoformat(),
        "max": row[1].isoformat(),
    }


def _fetch_month() -> dict:
    sql = """
        SELECT DISTINCT to_char(match_date, 'YYYY-MM') AS ym
        FROM games
        WHERE match_date IS NOT NULL
        ORDER BY ym DESC
    """
    with get_cursor(commit=False) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    return {"key": "month", "kind": "enum", "values": [r[0] for r in rows]}


# Dispatch table: dsl_key → fetch function (no DB args — all are read-only)
_FETCHERS: dict[str, object] = {
    "league": _fetch_league,
    "team": _fetch_team,
    "bettor": _fetch_bettor,
    "outcome": _fetch_outcome,
    "prediction": _fetch_prediction,
    "result": _fetch_result,
    "stake": _fetch_stake,
    "odds": _fetch_odds,
    "date": _fetch_date,
    "month": _fetch_month,
}

# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.get(
    "/api/filter/values",
    response_model=FilterValuesResponse,
    summary="Valid values for a DSL filter key",
)
async def get_filter_values(
    key: Annotated[str, Query(description="DSL filter key (e.g. league, team, bettor, stake)")],
    fresh: Annotated[int, Query(description="Set to 1 to bypass the in-process cache")] = 0,
) -> FilterValuesResponse:
    """Return the valid values (or numeric/date range) for a given DSL filter key.

    Responses are cached in-process with a 60-second TTL.  Pass ``?fresh=1``
    to bypass the cache and force a new DB query.

    Args:
        key: A DSL key from the parser's ``VALID_KEYS`` set.
        fresh: When non-zero, skip and refill the cache entry.

    Returns:
        One of :class:`FilterValuesEnum`, :class:`FilterValuesNumeric`, or
        :class:`FilterValuesDate` depending on the key type.

    Raises:
        HTTP 400 when *key* is not in ``VALID_KEYS``.
    """
    if key not in VALID_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown filter key: {key}",
        )

    use_cache = not bool(fresh)
    if use_cache:
        cached = _cache_get(key)
        if cached is not None:
            return cached  # type: ignore[return-value]

    fetcher = _FETCHERS[key]
    payload = fetcher()  # type: ignore[operator]
    _cache_set(key, payload)

    return payload  # type: ignore[return-value]
