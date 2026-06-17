"""LLM drafting interface — the seam to the air-gapped model endpoint.

Wave-0 freezes ONLY this signature and its "not configured" contract. The real
adapter (a thin pluggable client to Omer's air-gapped endpoint) is implemented
in Wave-1 Agent 1C. Per spec §4/§10, the endpoint is REQUIRED to create reports;
editing existing reports works without it.

Contract:
  `draft_report(notes, context) -> dict`
    notes   — the raw meeting notes pasted verbatim.
    context — existing-state hints for mapping (e.g. the champion's current
              domains/tasks/artifacts) so the model can rephrase, de-duplicate,
              and map notes onto existing entities. Shape decided in Wave-1.
    returns — a dict conforming to report_schema.json / models.ReportDocument.

  When no endpoint is configured, callers must get a clear, typed failure rather
  than a silent fallback — raise `LLMNotConfiguredError`.
"""


class LLMNotConfiguredError(RuntimeError):
    """Raised when report drafting is attempted but no model endpoint is configured.

    Wave-1's report-draft route should translate this into an HTTP 503 with a
    clear message ("LLM endpoint not configured") so the UI can tell the user
    to wire the air-gapped endpoint before creating reports.
    """

    def __init__(self, message: str = "LLM endpoint not configured") -> None:
        super().__init__(message)


def draft_report(notes: str, context: dict) -> dict:
    """Draft a structured weekly report (report_schema.json shape) from raw notes.

    Wave-0 stub: no endpoint is wired, so this always signals "not configured".
    Wave-1 Agent 1C replaces the body with the real air-gapped adapter call.
    """
    raise LLMNotConfiguredError()
