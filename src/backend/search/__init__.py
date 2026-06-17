"""Search DSL engine — public API re-export.

Adapted (Wave 1D) from a vendored SoccerSmartBet DSL to this app's SQLite
schema + keys (team, domain, type, tag, status, date). Self-contained: imports
``db`` / ``models`` from the backend root, no external project references.

Agent 1B's list endpoints import EXACTLY::

    from search import filter_tasks, filter_artifacts, ParseError
"""
from __future__ import annotations

from .autocomplete import build_values
from .parser import FilterClause, ParseError, parse
from .service import filter_artifacts, filter_tasks

__all__ = [
    "FilterClause",
    "ParseError",
    "build_values",
    "filter_artifacts",
    "filter_tasks",
    "parse",
]
