"""Query DSL service: parse → compile → execute → aggregate.

This module is the single entry point that Wave 12 HTTP routes call.
It owns no HTTP logic; it simply orchestrates the three pure layers below it.

    parse()   ← parser.py
    compile() ← compiler.py
    execute   ← TODO(Wave 1D): wire to the app's db layer (db.py)
    aggregate ← pure Python from result rows
"""
from __future__ import annotations

import logging
from decimal import Decimal

# TODO(Wave 1D): provide get_cursor from the app's SQLite db layer (db.py).
from .compiler import compile as compile_filter
from .models import BetRow, FilterAggregates, FilterResult
from .parser import ParseError, parse

logger = logging.getLogger(__name__)

# Column positions in the SELECT (0-based) — must stay in sync with
# compiler.BASE_SELECT.
# SELECT order: bet_id, bettor, prediction, stake, odds, result, pnl,
#               game_id, home_team, away_team, match_date, kickoff_time,
#               league, outcome, home_score, away_score
_COL_BET_ID = 0
_COL_BETTOR = 1
_COL_PREDICTION = 2
_COL_STAKE = 3
_COL_ODDS = 4
_COL_RESULT = 5
_COL_PNL = 6
_COL_GAME_ID = 7
_COL_HOME_TEAM = 8
_COL_AWAY_TEAM = 9
_COL_MATCH_DATE = 10
_COL_KICKOFF_TIME = 11
_COL_LEAGUE = 12
_COL_OUTCOME = 13
_COL_HOME_SCORE = 14
_COL_AWAY_SCORE = 15


def _row_to_bet_row(raw: tuple) -> BetRow:  # type: ignore[type-arg]
    """Map a raw DB tuple to a :class:`BetRow`.

    Args:
        raw: A tuple with columns in the order defined by ``compiler.BASE_SELECT``.

    Returns:
        A fully populated :class:`BetRow`.
    """
    return BetRow(
        bet_id=raw[_COL_BET_ID],
        bettor=raw[_COL_BETTOR],
        prediction=raw[_COL_PREDICTION],
        stake=Decimal(str(raw[_COL_STAKE])),
        odds=Decimal(str(raw[_COL_ODDS])),
        result=raw[_COL_RESULT],
        pnl=Decimal(str(raw[_COL_PNL])) if raw[_COL_PNL] is not None else None,
        game_id=raw[_COL_GAME_ID],
        home_team=raw[_COL_HOME_TEAM],
        away_team=raw[_COL_AWAY_TEAM],
        match_date=raw[_COL_MATCH_DATE],
        kickoff_time=raw[_COL_KICKOFF_TIME],
        league=raw[_COL_LEAGUE],
        outcome=raw[_COL_OUTCOME],
        home_score=raw[_COL_HOME_SCORE],
        away_score=raw[_COL_AWAY_SCORE],
    )


def _compute_aggregates(rows: list[BetRow]) -> FilterAggregates:
    """Compute summary statistics from result rows in Python.

    A single Python pass — avoids a second DB round-trip.

    Args:
        rows: All :class:`BetRow` instances returned by the query.

    Returns:
        :class:`FilterAggregates` with count, totals, and win rate.
    """
    total_stake = Decimal("0")
    total_pnl = Decimal("0")
    wins = 0
    settled = 0

    for row in rows:
        total_stake += row.stake
        if row.pnl is not None:
            total_pnl += row.pnl
            settled += 1
            if row.pnl > 0:
                wins += 1

    win_rate: float | None = (wins / settled) if settled > 0 else None

    return FilterAggregates(
        count=len(rows),
        total_stake=total_stake,
        total_pnl=total_pnl,
        win_rate=win_rate,
    )


def run_filter(dsl: str, row_cap: int = 2000) -> FilterResult:
    """Execute a DSL filter query and return a :class:`FilterResult`.

    Parse errors bubble up as :class:`.parser.ParseError`
    (HTTP 400 in Wave 12 routes).  All other exceptions propagate as-is.

    Args:
        dsl: Raw DSL string from the user.  Empty → match everything.
        row_cap: Maximum rows to return (hard-capped at 2000 inside the
            compiler; Wave 12 routes may pass a stricter value such as 500).

    Returns:
        A :class:`FilterResult` with populated rows, aggregates, and metadata.

    Raises:
        ParseError: When the DSL contains an unknown key or malformed token.
    """
    ast = parse(dsl)  # ParseError propagates
    sql, params = compile_filter(ast, row_cap=row_cap)

    logger.debug("run_filter: dsl=%r  row_cap=%d", dsl, row_cap)

    rows: list[BetRow] = []
    with get_cursor(commit=False) as cur:
        cur.execute(sql, params)
        for raw in cur.fetchall():
            rows.append(_row_to_bet_row(raw))

    aggregates = _compute_aggregates(rows)
    row_cap_hit = len(rows) == min(row_cap, 2000)

    return FilterResult(
        rows=rows,
        aggregates=aggregates,
        row_cap_hit=row_cap_hit,
        dsl=dsl,
    )
