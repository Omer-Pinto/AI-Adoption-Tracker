"""Report engine — the fan-out (save) and replay (edit) of weekly reports.

`routes/reports.py` stays thin; all the SQLite read/write orchestration lives
here. See `engine.py`.
"""

from .engine import (
    EngineError,
    ReportNotFoundError,
    apply_manual_artifact_edit,
    apply_manual_task_edit,
    build_draft_context,
    fan_out_report,
    get_report_row,
    replay_report_edit,
)

__all__ = [
    "EngineError",
    "ReportNotFoundError",
    "apply_manual_artifact_edit",
    "apply_manual_task_edit",
    "build_draft_context",
    "fan_out_report",
    "get_report_row",
    "replay_report_edit",
]
