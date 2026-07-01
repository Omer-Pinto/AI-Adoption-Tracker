"""Reports API — draft (notes -> structured), confirm/save fan-out, edit + replay.

Thin HTTP layer over the `reports` engine package: parse/validate the request,
open a connection, delegate to the engine (which owns the transaction), and
shape the response. See `reports/engine.py` for the fan-out + replay logic and
`llm/interface.py` for the air-gapped drafting seam.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

import llm.interface as llm
from db import get_connection
from models import Report, ReportDocument
from reports import (
    ReportNotFoundError,
    apply_draft_defaults,
    build_draft_context,
    fan_out_report,
    get_report_row,
    replay_report_edit,
)
from reports.engine import EngineError

router = APIRouter(prefix="/api/reports", tags=["reports"])


class DraftRequest(BaseModel):
    """Body for `POST /api/reports/draft` (§3): the team + raw notes (Wave 16)."""

    team_id: int
    notes: str


class ReportResponse(BaseModel):
    """Typed envelope for all single-report responses: `{ "report": Report }`.

    Using a wrapper model (rather than returning a bare ``Report``) matches the
    existing runtime JSON shape so the frontend contract is unchanged. The
    OpenAPI spec will now show a typed schema instead of ``additionalProperties``.
    """

    report: Report


def _report_payload(row) -> ReportResponse:
    """Wrap a `report` row in the `{ "report": {...} }` envelope (report_json
    stays a JSON-encoded string, per `models.Report`)."""
    return ReportResponse(report=Report.model_validate(dict(row)))


@router.post("/draft")
def draft(req: DraftRequest) -> ReportDocument:
    """Draft a structured (unsaved) report from raw notes via the LLM adapter."""
    conn = get_connection()
    try:
        try:
            context = build_draft_context(conn, req.team_id)
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

    # Validate the model output against the report contract, then fill the
    # derived defaults (task owner, artifact change_kind) so the PREVIEW the
    # editor shows already matches what save will compute — no blank owner
    # dropdown (D8) and no missing change_kind (D3).
    doc = ReportDocument.model_validate(drafted)
    return apply_draft_defaults(doc, context)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=ReportResponse)
def save(doc: ReportDocument, team_id: int = Query(...)) -> ReportResponse:
    """Confirm a previewed draft -> fan out to the tables in one transaction.

    `team_id` is a required query param (Wave 16): the report is keyed by team,
    and the engine overwrites `report_json.champion` with the team's live
    champion name. Unknown team -> 404; a duplicate (team_id, meeting_date) or
    other validation failure -> 422.
    """
    conn = get_connection()
    try:
        if conn.execute(
            "SELECT 1 FROM team WHERE id = ?", (team_id,)
        ).fetchone() is None:
            raise HTTPException(status_code=404, detail="Team not found")
        try:
            row = fan_out_report(conn, team_id, doc)
        except EngineError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _report_payload(row)
    finally:
        conn.close()


@router.get("/{report_id}", response_model=ReportResponse)
def get_one(report_id: int) -> ReportResponse:
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


@router.patch("/{report_id}", response_model=ReportResponse)
def edit(report_id: int, doc: ReportDocument) -> ReportResponse:
    """Edit a saved report + replay the team's timeline (no LLM needed).

    Replays by the existing report's `team_id` (Wave 16); the engine derives the
    team from the stored report, so the body stays a plain `ReportDocument`.

    LATEST-ONLY (A1+A2): only the team's newest report is editable — older reports
    are read-only. "Latest" is the team's report with the greatest `meeting_date`
    (tie-break by greatest `id`). Editing a non-latest report → 409.
    """
    conn = get_connection()
    try:
        try:
            target = get_report_row(conn, report_id)
        except ReportNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        latest = conn.execute(
            "SELECT id FROM report WHERE team_id = ? "
            "ORDER BY meeting_date DESC, id DESC LIMIT 1",
            (target["team_id"],),
        ).fetchone()
        if latest is not None and latest["id"] != report_id:
            raise HTTPException(
                status_code=409,
                detail="Only the latest report can be edited; older reports "
                "are read-only.",
            )

        try:
            row = replay_report_edit(conn, report_id, doc)
        except ReportNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except EngineError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return _report_payload(row)
    finally:
        conn.close()
