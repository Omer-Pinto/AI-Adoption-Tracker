"""LLM drafting interface — provider-agnostic adapter (OpenAI + Anthropic).

Wave-2 Agent 2A implements the real multi-provider adapter here, replacing the
single-endpoint urllib POST client from Wave-1. Per spec §4/§10 and decisions.md,
both OpenAI and Anthropic are supported; a config value selects the provider.
URL + key live in `.env` (never committed).

Contract (unchanged from Wave-0 / Wave-1):
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

  When the endpoint is configured but unreachable/failing, raise `LLMRequestError`
  (separate from "not configured", per decisions.md).

Configuration (all env vars — document in .env.example):
  TRACKER_LLM_PROVIDER  — required. "openai" or "anthropic". Selects the API
                          wire format. Unset/blank ⇒ LLMNotConfiguredError.
  TRACKER_LLM_API_KEY   — required. Sent as Authorization: Bearer <key> (OpenAI)
                          or x-api-key header (Anthropic). Unset/blank ⇒
                          LLMNotConfiguredError.
  TRACKER_LLM_MODEL     — optional. Model ID to use.
                          Default OpenAI:    gpt-4o
                          Default Anthropic: claude-3-5-sonnet-20241022
  TRACKER_LLM_ENDPOINT  — optional. Override base URL (air-gapped / proxied
                          deployment). When blank, public API URLs are used:
                          OpenAI:    https://api.openai.com/v1
                          Anthropic: https://api.anthropic.com/v1
  TRACKER_LLM_TIMEOUT   — optional. Request timeout in seconds (default 120).

Wire format (per provider):
  OpenAI (Chat Completions):
    POST {base_url}/chat/completions
    Headers: Authorization: Bearer <key>, Content-Type: application/json
    Body: {"model": <model>, "response_format": {"type": "json_object"},
           "messages": [{"role": "system", ...}, {"role": "user", ...}]}
    Response: choices[0].message.content  (JSON string → parse → unwrap "report")

  Anthropic (Messages):
    POST {base_url}/messages
    Headers: x-api-key: <key>, anthropic-version: 2023-06-01,
             Content-Type: application/json
    Body: {"model": <model>, "max_tokens": 4096,
           "system": <system_prompt>,
           "messages": [{"role": "user", ...}]}
    Response: content[0].text  (JSON string → parse → unwrap "report")

Design decisions flagged:
  * TRACKER_LLM_PROVIDER is the new required selector env var.
  * Default OpenAI model: "gpt-4o" (supports json_object response_format).
  * Default Anthropic model: "claude-3-5-sonnet-20241022".
  * Anthropic API version header: "2023-06-01" (minimum stable for Messages API).
  * JSON mode for OpenAI: response_format={"type":"json_object"} — requires the
    word "JSON" in the prompt, which the system prompt provides.
  * Anthropic has no json_object mode — the system prompt instructs JSON emission
    and we parse the first JSON object found in the response text.
  * No SDK dependency — stdlib urllib only (per instructions).
  * TRACKER_LLM_ENDPOINT overrides the base URL for air-gapped / proxy use.
  * When TRACKER_LLM_ENDPOINT is set, it is used as-is as the base (we append
    the provider's path segment: /chat/completions or /messages).
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
_ENDPOINT_ENV = "TRACKER_LLM_ENDPOINT"   # optional base-URL override
_TIMEOUT_ENV = "TRACKER_LLM_TIMEOUT"

# Provider identifiers
_PROVIDER_OPENAI = "openai"
_PROVIDER_ANTHROPIC = "anthropic"

# Defaults
_DEFAULT_OPENAI_BASE = "https://api.openai.com/v1"
_DEFAULT_ANTHROPIC_BASE = "https://api.anthropic.com/v1"
_DEFAULT_OPENAI_MODEL = "gpt-4o"
_DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"
_DEFAULT_TIMEOUT = 120.0
_ANTHROPIC_API_VERSION = "2023-06-01"
_ANTHROPIC_MAX_TOKENS = 4096

_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "report_schema.json"


# ---------------------------------------------------------------------------
# Public exception types (preserved from Wave-0/1 — callers depend on these)
# ---------------------------------------------------------------------------

class LLMNotConfiguredError(RuntimeError):
    """Raised when report drafting is attempted but no model endpoint is configured.

    The report-draft route translates this into an HTTP 503 with a clear
    message ("LLM endpoint not configured") so the UI can tell the user to wire
    the endpoint before creating reports.
    """

    def __init__(self, message: str = "LLM endpoint not configured") -> None:
        super().__init__(message)


class LLMRequestError(RuntimeError):
    """The endpoint was configured but the drafting call failed (transport,
    HTTP status, or an unparseable/non-object response).

    Separate from LLMNotConfiguredError per decisions.md:
    "if the AI endpoint is set but down, the app says so clearly."
    """


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _provider() -> str:
    """Return the normalised provider string or raise LLMNotConfiguredError."""
    val = os.environ.get(_PROVIDER_ENV, "").strip().lower()
    if not val:
        raise LLMNotConfiguredError(
            "TRACKER_LLM_PROVIDER is not set. Set it to 'openai' or 'anthropic'."
        )
    if val not in (_PROVIDER_OPENAI, _PROVIDER_ANTHROPIC):
        raise LLMNotConfiguredError(
            f"TRACKER_LLM_PROVIDER='{val}' is not supported. "
            "Use 'openai' or 'anthropic'."
        )
    return val


def _api_key() -> str:
    """Return the API key or raise LLMNotConfiguredError."""
    key = os.environ.get(_API_KEY_ENV, "").strip()
    if not key:
        raise LLMNotConfiguredError(
            "TRACKER_LLM_API_KEY is not set. Supply the API key for the chosen provider."
        )
    return key


def _model(provider: str) -> str:
    override = os.environ.get(_MODEL_ENV, "").strip()
    if override:
        return override
    return _DEFAULT_OPENAI_MODEL if provider == _PROVIDER_OPENAI else _DEFAULT_ANTHROPIC_MODEL


def _base_url(provider: str) -> str:
    """Return the base URL, stripping any trailing slash."""
    override = os.environ.get(_ENDPOINT_ENV, "").strip().rstrip("/")
    if override:
        return override
    return _DEFAULT_OPENAI_BASE if provider == _PROVIDER_OPENAI else _DEFAULT_ANTHROPIC_BASE


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
    """POST to OpenAI Chat Completions; return the raw content string."""
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
            f"OpenAI API returned HTTP {exc.code}: {error_body[:300]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMRequestError(f"OpenAI request failed: {exc}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMRequestError("OpenAI returned non-JSON response") from exc

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMRequestError(
            f"Unexpected OpenAI response shape: {str(data)[:300]}"
        ) from exc


def _call_anthropic(api_key: str, model: str, base_url: str, system: str, user: str) -> str:
    """POST to Anthropic Messages API; return the raw content text string."""
    url = f"{base_url}/messages"
    payload = json.dumps({
        "model": model,
        "max_tokens": _ANTHROPIC_MAX_TOKENS,
        "system": system,
        "messages": [
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
            "x-api-key": api_key,
            "anthropic-version": _ANTHROPIC_API_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=_timeout()) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise LLMRequestError(
            f"Anthropic API returned HTTP {exc.code}: {error_body[:300]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMRequestError(f"Anthropic request failed: {exc}") from exc

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMRequestError("Anthropic returned non-JSON response") from exc

    try:
        return data["content"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMRequestError(
            f"Unexpected Anthropic response shape: {str(data)[:300]}"
        ) from exc


# ---------------------------------------------------------------------------
# JSON extraction helpers
# ---------------------------------------------------------------------------

def _extract_json(raw: str) -> dict:
    """Parse a JSON object from the model's text response.

    Handles:
      1. Clean JSON string (direct parse).
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
    """Unwrap a top-level 'report' key if present (both providers use this)."""
    if "report" in data and isinstance(data["report"], dict):
        return data["report"]
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def draft_report(notes: str, context: dict) -> dict:
    """Draft a structured weekly report (report_schema.json shape) from raw notes.

    Detects provider from TRACKER_LLM_PROVIDER env var, builds the appropriate
    API request via stdlib urllib, and returns the structured dict. The caller
    (the reports route) validates the dict against ReportDocument.

    Raises:
      LLMNotConfiguredError — TRACKER_LLM_PROVIDER or TRACKER_LLM_API_KEY unset.
      LLMRequestError       — endpoint configured but call failed (transport,
                              HTTP error, or unparseable/non-object response).
    """
    provider = _provider()   # raises LLMNotConfiguredError if unset/invalid
    api_key = _api_key()     # raises LLMNotConfiguredError if unset
    model = _model(provider)
    base_url = _base_url(provider)
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
