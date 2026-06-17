"""LLM drafting interface — the seam to the air-gapped model endpoint.

Wave-0 freezes ONLY this signature and its "not configured" contract. The real
adapter (a thin, dependency-light client to Omer's air-gapped endpoint) is
implemented here in Wave-1 Agent 1C. Per spec §4/§10, the endpoint is REQUIRED
to create reports; editing existing reports works without it.

Contract:
  `draft_report(notes, context) -> dict`
    notes   — the raw meeting notes pasted verbatim.
    context — existing-state hints for mapping (the champion's current
              domains/tasks/artifacts) so the model can rephrase, de-duplicate,
              and map notes onto existing entities. Built by the reports engine
              (`reports.build_draft_context`).
    returns — a dict conforming to report_schema.json / models.ReportDocument.

  When no endpoint is configured, callers must get a clear, typed failure rather
  than a silent fallback — raise `LLMNotConfiguredError`. There is NO fabricated
  fallback report.

Configuration (decision — flagged as an uncertainty):
  * `TRACKER_LLM_ENDPOINT` — required. Full URL of the air-gapped POST endpoint.
    Unset/blank ⇒ `LLMNotConfiguredError`.
  * `TRACKER_LLM_API_KEY`  — optional. Sent as `Authorization: Bearer <key>`.
  * `TRACKER_LLM_TIMEOUT`  — optional. Request timeout in seconds (default 120).

Wire format (decision — flagged):
  * Request  (POST, JSON): `{"notes": <str>, "context": <dict>,
                             "schema": <report_schema.json contents>}`
    The JSON Schema is sent so the model can be told exactly what to emit.
  * Response (JSON): either the `ReportDocument` object directly, or
    `{"report": {…}}` — we unwrap a top-level `report` key if present.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

_ENDPOINT_ENV = "TRACKER_LLM_ENDPOINT"
_API_KEY_ENV = "TRACKER_LLM_API_KEY"
_TIMEOUT_ENV = "TRACKER_LLM_TIMEOUT"
_DEFAULT_TIMEOUT = 120.0

_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "report_schema.json"


class LLMNotConfiguredError(RuntimeError):
    """Raised when report drafting is attempted but no model endpoint is configured.

    Wave-1's report-draft route translates this into an HTTP 503 with a clear
    message ("LLM endpoint not configured") so the UI can tell the user to wire
    the air-gapped endpoint before creating reports.
    """

    def __init__(self, message: str = "LLM endpoint not configured") -> None:
        super().__init__(message)


class LLMRequestError(RuntimeError):
    """The endpoint was configured but the drafting call failed (transport,
    HTTP status, or an unparseable/non-object response)."""


def _endpoint() -> str:
    endpoint = os.environ.get(_ENDPOINT_ENV, "").strip()
    if not endpoint:
        raise LLMNotConfiguredError()
    return endpoint


def _timeout() -> float:
    raw = os.environ.get(_TIMEOUT_ENV, "").strip()
    if not raw:
        return _DEFAULT_TIMEOUT
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_TIMEOUT


def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


def draft_report(notes: str, context: dict) -> dict:
    """Draft a structured weekly report (report_schema.json shape) from raw notes.

    Thin pluggable client: POST the notes + context (+ the JSON Schema) to the
    configured air-gapped endpoint and return the model's structured dict. The
    caller (the reports route) validates the dict against `ReportDocument`."""
    endpoint = _endpoint()  # raises LLMNotConfiguredError when unset.

    payload = json.dumps(
        {"notes": notes, "context": context, "schema": _load_schema()}
    ).encode("utf-8")

    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    api_key = os.environ.get(_API_KEY_ENV, "").strip()
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=_timeout()) as resp:
            body = resp.read()
    except urllib.error.URLError as exc:  # connection refused, DNS, timeout, HTTP
        raise LLMRequestError(f"LLM drafting request failed: {exc}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMRequestError("LLM endpoint returned non-JSON response") from exc

    if isinstance(data, dict) and "report" in data and isinstance(data["report"], dict):
        data = data["report"]
    if not isinstance(data, dict):
        raise LLMRequestError("LLM endpoint did not return a report object")
    return data
