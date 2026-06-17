"""Reports API — draft (notes -> structured), confirm/save fan-out, edit + replay.

Thin HTTP layer over the `reports` engine package: parse/validate the request,
open a connection, delegate to the engine (which owns the transaction), and
shape the response. See `reports/engine.py` for the fan-out + replay logic and
`llm/interface.py` for the air-gapped drafting seam.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

import llm.interface as llm
from db import get_connection
from models import Report, ReportDocument
from reports import (
    ReportNotFoundError,
    build_draft_context,
    fan_out_report,
    get_report_row,
    replay_report_edit,
)
from reports.engine import EngineError

router = APIRouter(prefix="/api/reports", tags=["reports"])


class DraftRequest(BaseModel):
    """Body for `POST /api/reports/draft` (§3): the champion + raw notes."""

    champion_id: int
    notes: str


def _report_payload(row) -> dict:
    """Wrap a `report` row in the `{ "report": {...} }` envelope (report_json
    stays a JSON-encoded string, per `models.Report`)."""
    return {"report": Report.model_validate(dict(row)).model_dump()}


@router.post("/draft")
def draft(req: DraftRequest) -> ReportDocument:
    """Draft a structured (unsaved) report from raw notes via the LLM adapter."""
    conn = get_connection()
    try:
        try:
            context = build_draft_context(conn, req.champion_id)
        except EngineError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    finally:
        conn.close()

    try:
        drafted = llm.draft_report(req.notes, context)
    except llm.LLMNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except llm.LLMRequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # Validate the model output against the report contract before returning it.
    return ReportDocument.model_validate(drafted)


@router.post("", status_code=status.HTTP_201_CREATED)
def save(doc: ReportDocument) -> dict:
    """Confirm a previewed draft -> fan out to the tables in one transaction."""
    conn = get_connection()
    try:
        try:
            row = fan_out_report(conn, doc)
        except EngineError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _report_payload(row)
    finally:
        conn.close()


@router.get("/{report_id}")
def get_one(report_id: int) -> dict:
    """Fetch one saved report (report_json kept as a JSON string)."""
    conn = get_connection()
    try:
        try:
            row = get_report_row(conn, report_id)
        except ReportNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return _report_payload(row)
    finally:
        conn.close()


@router.patch("/{report_id}")
def edit(report_id: int, doc: ReportDocument) -> dict:
    """Edit a saved report + replay the champion's timeline (no LLM needed)."""
    conn = get_connection()
    try:
        try:
            row = replay_report_edit(conn, report_id, doc)
        except ReportNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except EngineError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _report_payload(row)
    finally:
        conn.close()
