"""Query DSL engine — public API re-export.

Vendored from an external project as the adaptation base for the search DSL.
Routes import from here::

    from search import run_filter, FilterResult, ParseError
"""
from __future__ import annotations

from .models import FilterResult
from .parser import FilterClause, ParseError
from .service import run_filter

__all__ = [
    "FilterClause",
    "FilterResult",
    "ParseError",
    "run_filter",
]
