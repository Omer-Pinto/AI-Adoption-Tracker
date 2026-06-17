"""Report engine — the fan-out (save) and replay (edit) of weekly reports.

`routes/reports.py` stays thin; all the SQLite read/write orchestration lives
here. See `engine.py`.
"""

from .engine import (
    EngineError,
    ReportNotFoundError,
    build_draft_context,
    fan_out_report,
    get_report_row,
    replay_report_edit,
)

__all__ = [
    "EngineError",
    "ReportNotFoundError",
    "build_draft_context",
    "fan_out_report",
    "get_report_row",
    "replay_report_edit",
]
