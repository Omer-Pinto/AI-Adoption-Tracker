"""LLM drafting interface — provider-agnostic adapter (OpenAI-compatible + Anthropic-compatible).

This module targets AIR-GAPPED deployments. There are no public API URLs and no
hosted model defaults. Every value comes from operator-supplied environment
variables. "Provider" selects only the HTTP wire format / API dialect — it does
NOT imply a specific hosted vendor.

Contract (unchanged from Wave-0 / Wave-1 — callers must not be broken):
  `draft_report(notes, context) -> dict`
    notes   — the raw meeting notes pasted verbatim.
    context — existing-state hints for mapping (the champion's current
              domains/tasks/artifacts) so the model can rephrase, de-duplicate,
              and map notes onto existing entities. Built by the reports engine
              (`reports.build_draft_context`).
    returns — a dict conforming to report_schema.json / models.ReportDocument.

  When any required config var is unset or blank, raise `LLMNotConfiguredError`.
  There is NO fabricated fallback report and NO public-API fallback URL.

  When all config vars are present but the call fails (transport, HTTP error,
  unparseable response), raise `LLMRequestError`. This distinction is required
  by decisions.md: "if the AI endpoint is set but down, the app says so clearly."

Configuration — ALL FOUR ARE REQUIRED (unset/blank ⇒ LLMNotConfiguredError):
  TRACKER_LLM_PROVIDER   — "openai" or "anthropic". Selects the API wire format.
  TRACKER_LLM_ENDPOINT   — Full base URL of the air-gapped inference server
                            (e.g. http://llm-host:8080/v1). No default, no public
                            fallback — must be set explicitly.
  TRACKER_LLM_API_KEY    — Bearer token / API key for the inference server. Sent
                            as `Authorization: Bearer <key>` (openai dialect) or
                            `x-api-key: <key>` (anthropic dialect).
  TRACKER_LLM_MODEL      — Served model name as the inference server expects it
                            (e.g. "llama-3-70b", "mistral-7b-instruct"). No
                            hosted-model default.

Optional:
  TRACKER_LLM_TIMEOUT          — Request timeout in seconds (default 120).
  TRACKER_LLM_ANTHROPIC_VERSION — Override the `anthropic-version` header sent
                                   in the Anthropic dialect (default "2023-06-01").
                                   Some OSS server implementations require a
                                   specific value or ignore the header entirely;
                                   this escape hatch lets operators set it without
                                   a code change.

Wire format (per dialect):
  openai (Chat Completions):
    POST {TRACKER_LLM_ENDPOINT}/chat/completions
    Headers: Authorization: Bearer <key>, Content-Type: application/json
    Body: {"model": <model>, "response_format": {"type": "json_object"},
           "messages": [{"role": "system", ...}, {"role": "user", ...}]}
    Response: choices[0].message.content  (JSON string → parse → unwrap "report")
    Note: response_format is sent as a hint; servers that ignore it are handled
    via the same robust fence/brace JSON extraction used for the anthropic dialect.

  anthropic (Messages API):
    POST {TRACKER_LLM_ENDPOINT}/messages
    Headers: x-api-key: <key>, anthropic-version: <version>,
             Content-Type: application/json
    Body: {"model": <model>, "max_tokens": 4096,
           "system": <system_prompt>,
           "messages": [{"role": "user", ...}, {"role": "assistant", "{"}]}
    The trailing assistant message prefills the response with `{`, forcing the
    server to continue a JSON object. The returned text is prepended with `{`
    before parsing (fence/brace fallback still applies as a safety net).
    Response: content[0].text  (reconstruct → parse → unwrap "report")

Design decisions:
  * All four config vars (provider/endpoint/api_key/model) are required. Blank ⇒
    LLMNotConfiguredError, not a silent default.
  * No SDK dependency — stdlib urllib only.
  * Anthropic JSON reliability: assistant-message prefill of `{` forces a JSON
    object continuation at the server level. The response text is reconstructed by
    prepending `{` before parsing. Fence/brace regex extraction is kept as a
    secondary fallback.
  * anthropic-version default: "2023-06-01" (minimum stable version for the
    Messages API). Overridable via TRACKER_LLM_ANTHROPIC_VERSION.
  * OpenAI dialect sends response_format=json_object. Servers that honour it
    return clean JSON; those that ignore it still go through the shared extractor.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Env-var names
# ---------------------------------------------------------------------------
_PROVIDER_ENV = "TRACKER_LLM_PROVIDER"
_API_KEY_ENV = "TRACKER_LLM_API_KEY"
_MODEL_ENV = "TRACKER_LLM_MODEL"
_ENDPOINT_ENV = "TRACKER_LLM_ENDPOINT"
_TIMEOUT_ENV = "TRACKER_LLM_TIMEOUT"
_ANTHROPIC_VERSION_ENV = "TRACKER_LLM_ANTHROPIC_VERSION"

# Provider identifiers
_PROVIDER_OPENAI = "openai"
_PROVIDER_ANTHROPIC = "anthropic"

# Non-overridable constants
_DEFAULT_TIMEOUT = 120.0
# Minimum stable version for the Anthropic Messages API. Overridable via
# TRACKER_LLM_ANTHROPIC_VERSION for operators whose OSS server needs a
# specific value or ignores this header altogether.
_DEFAULT_ANTHROPIC_API_VERSION = "2023-06-01"
_ANTHROPIC_MAX_TOKENS = 4096

_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "report_schema.json"


# ---------------------------------------------------------------------------
# Public exception types (preserved from Wave-0/1 — callers depend on these)
# ---------------------------------------------------------------------------

class LLMNotConfiguredError(RuntimeError):
    """Raised when report drafting is attempted but required config is missing.

    Triggered when ANY of TRACKER_LLM_PROVIDER, TRACKER_LLM_ENDPOINT,
    TRACKER_LLM_API_KEY, or TRACKER_LLM_MODEL is unset or blank.

    The report-draft route translates this into HTTP 503 with a clear message
    ("LLM endpoint not configured") so the UI can instruct the operator to
    supply all four variables before creating reports.
    """

    def __init__(self, message: str = "LLM endpoint not configured") -> None:
        super().__init__(message)


class LLMRequestError(RuntimeError):
    """The endpoint was configured but the drafting call failed.

    Covers: transport errors, non-2xx HTTP responses, unparseable or
    non-object JSON in the reply.

    Separate from LLMNotConfiguredError per decisions.md:
    "if the AI endpoint is set but down, the app says so clearly."
    """


# ---------------------------------------------------------------------------
# Config helpers — all required vars raise LLMNotConfiguredError when blank
# ---------------------------------------------------------------------------

def _provider() -> str:
    """Return the normalised provider string or raise LLMNotConfiguredError."""
    val = os.environ.get(_PROVIDER_ENV, "").strip().lower()
    if not val:
        raise LLMNotConfiguredError(
            "TRACKER_LLM_PROVIDER is not set. "
            "Set it to 'openai' or 'anthropic' to select the wire format."
        )
    if val not in (_PROVIDER_OPENAI, _PROVIDER_ANTHROPIC):
        raise LLMNotConfiguredError(
            f"TRACKER_LLM_PROVIDER='{val}' is not a supported wire format. "
            "Use 'openai' or 'anthropic'."
        )
    return val


def _api_key() -> str:
    """Return the API key or raise LLMNotConfiguredError."""
    key = os.environ.get(_API_KEY_ENV, "").strip()
    if not key:
        raise LLMNotConfiguredError(
            "TRACKER_LLM_API_KEY is not set. "
            "Supply the credential for the air-gapped inference server."
        )
    return key


def _model() -> str:
    """Return the model name or raise LLMNotConfiguredError. No hosted default."""
    name = os.environ.get(_MODEL_ENV, "").strip()
    if not name:
        raise LLMNotConfiguredError(
            "TRACKER_LLM_MODEL is not set. "
            "Supply the model name exactly as the inference server serves it."
        )
    return name


def _base_url() -> str:
    """Return the operator-supplied base URL or raise LLMNotConfiguredError."""
    url = os.environ.get(_ENDPOINT_ENV, "").strip().rstrip("/")
    if not url:
        raise LLMNotConfiguredError(
            "TRACKER_LLM_ENDPOINT is not set. "
            "Supply the full base URL of the air-gapped inference server "
            "(e.g. http://llm-host:8080/v1). There is no public-API fallback."
        )
    return url


def _timeout() -> float:
    raw = os.environ.get(_TIMEOUT_ENV, "").strip()
    if not raw:
        return _DEFAULT_TIMEOUT
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_TIMEOUT


def _anthropic_version() -> str:
    """Return the anthropic-version header value.

    Reads TRACKER_LLM_ANTHROPIC_VERSION; falls back to the module default
    "2023-06-01". The env var exists solely as an operator escape hatch for
    OSS inference servers that mandate or ignore a specific version string.
    """
    override = os.environ.get(_ANTHROPIC_VERSION_ENV, "").strip()
    return override if override else _DEFAULT_ANTHROPIC_API_VERSION


def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_TEMPLATE = """\
You are a structured-report assistant for an AI adoption tracking tool.
Given raw meeting notes and context about a champion's existing domains,
tasks, and artifacts, you produce a structured JSON report.

The report MUST conform exactly to this JSON Schema:
{schema}

Rules:
- Output ONLY valid JSON — no markdown, no code fences, no prose before or after.
- Wrap the report in a top-level "report" key: {{"report": {{...}}}}.
- Map notes onto existing tasks and artifacts using the names in `context`.
- De-duplicate: if the same task appears multiple times in the notes, emit it once.
- Use `task` (existing name) vs `new_task` (brand-new) as the schema requires.
- Use `artifact` (existing name) vs `new_artifact` (brand-new) as the schema requires.
- Rephrase raw note language into clean, concise field values.
- `raw_notes` MUST contain the original notes verbatim.
- `meeting_date` MUST be an ISO-8601 date (YYYY-MM-DD).
- Only include domain `changes` fields that actually changed in this meeting.
"""

_USER_PROMPT_TEMPLATE = """\
Context (champion's current state — use this to map tasks/artifacts):
{context}

Raw meeting notes to structure:
{notes}

Produce the structured JSON report now.
"""


def _build_prompts(notes: str, context: dict) -> tuple[str, str]:
    schema = _load_schema()
    system = _SYSTEM_PROMPT_TEMPLATE.format(schema=json.dumps(schema, indent=2))
    user = _USER_PROMPT_TEMPLATE.format(
        context=json.dumps(context, indent=2, ensure_ascii=False),
        notes=notes,
    )
    return system, user


# ---------------------------------------------------------------------------
# Provider-specific call implementations (stdlib urllib only)
# ---------------------------------------------------------------------------

def _call_openai(api_key: str, model: str, base_url: str, system: str, user: str) -> str:
    """POST to an OpenAI-compatible Chat Completions endpoint; return raw content string.

    response_format=json_object is sent as a hint. Servers that honour it return
    clean JSON. Servers that ignore it still go through the shared _extract_json
    fence/brace extractor.
    """
    url = f"{base_url}/chat/completions"
    payload = json.dumps({
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_timeout()) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise LLMRequestError(
            f"Inference server (openai dialect) returned HTTP {exc.code}: {error_body[:300]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMRequestError(
            f"Inference server (openai dialect) request failed: {exc}"
        ) from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMRequestError(
            "Inference server (openai dialect) returned non-JSON response"
        ) from exc

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMRequestError(
            f"Unexpected openai-dialect response shape: {str(data)[:300]}"
        ) from exc


def _call_anthropic(api_key: str, model: str, base_url: str, system: str, user: str) -> str:
    """POST to an Anthropic-compatible Messages endpoint; return reconstructed JSON string.

    JSON reliability mechanism: an assistant-message prefill of `{` is appended
    to the messages list. This forces the server to continue a JSON object rather
    than emitting preamble prose. The server returns only the continuation (without
    the prefill character itself), so we reconstruct by prepending `{` to whatever
    the server returns before handing the string to _extract_json.

    The fence/brace fallback in _extract_json still applies as a secondary safety net.
    """
    url = f"{base_url}/messages"
    payload = json.dumps({
        "model": model,
        "max_tokens": _ANTHROPIC_MAX_TOKENS,
        "system": system,
        "messages": [
            {"role": "user", "content": user},
            # Assistant prefill: forces server to continue a JSON object.
            {"role": "assistant", "content": "{"},
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": api_key,
            "anthropic-version": _anthropic_version(),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_timeout()) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise LLMRequestError(
            f"Inference server (anthropic dialect) returned HTTP {exc.code}: {error_body[:300]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMRequestError(
            f"Inference server (anthropic dialect) request failed: {exc}"
        ) from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMRequestError(
            "Inference server (anthropic dialect) returned non-JSON response"
        ) from exc

    try:
        continuation = data["content"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMRequestError(
            f"Unexpected anthropic-dialect response shape: {str(data)[:300]}"
        ) from exc

    # Reconstruct the full JSON object: the prefill `{` was consumed by the
    # server as the start of the response; the server returns only the
    # continuation. Prepend `{` to restore the complete object string.
    return "{" + continuation


# ---------------------------------------------------------------------------
# JSON extraction helpers
# ---------------------------------------------------------------------------

def _extract_json(raw: str) -> dict:
    """Parse a JSON object from the model's text response.

    Handles:
      1. Clean JSON string (direct parse) — expected path after prefill reconstruction.
      2. JSON wrapped in markdown code fences (```json ... ```).
      3. First {...} block found via regex fallback.
    """
    text = raw.strip()

    # Strip markdown fences if present
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Fallback: find first {...} block
        brace_match = re.search(r"\{[\s\S]*\}", text)
        if not brace_match:
            raise LLMRequestError("LLM response contained no JSON object")
        try:
            data = json.loads(brace_match.group(0))
        except json.JSONDecodeError as exc:
            raise LLMRequestError(
                "LLM response JSON could not be parsed"
            ) from exc

    if not isinstance(data, dict):
        raise LLMRequestError("LLM did not return a JSON object")
    return data


def _unwrap_report(data: dict) -> dict:
    """Unwrap a top-level 'report' key if present (both dialects use this)."""
    if "report" in data and isinstance(data["report"], dict):
        return data["report"]
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def draft_report(notes: str, context: dict) -> dict:
    """Draft a structured weekly report (report_schema.json shape) from raw notes.

    Reads all four required env vars (TRACKER_LLM_PROVIDER, TRACKER_LLM_ENDPOINT,
    TRACKER_LLM_API_KEY, TRACKER_LLM_MODEL), builds the appropriate API request
    via stdlib urllib, and returns the structured dict. The caller (the reports
    route) validates the dict against ReportDocument.

    Raises:
      LLMNotConfiguredError — ANY of provider/endpoint/api_key/model is unset or blank.
      LLMRequestError       — all four vars present but call failed (transport,
                              HTTP error, or unparseable/non-object response).
    """
    provider = _provider()    # raises LLMNotConfiguredError if unset/invalid
    api_key = _api_key()      # raises LLMNotConfiguredError if unset/blank
    model = _model()          # raises LLMNotConfiguredError if unset/blank
    base_url = _base_url()    # raises LLMNotConfiguredError if unset/blank
    system, user = _build_prompts(notes, context)

    if provider == _PROVIDER_OPENAI:
        raw = _call_openai(api_key, model, base_url, system, user)
    else:  # anthropic
        raw = _call_anthropic(api_key, model, base_url, system, user)

    data = _extract_json(raw)
    data = _unwrap_report(data)

    if not isinstance(data, dict):
        raise LLMRequestError("LLM endpoint did not return a report object")
    return data
