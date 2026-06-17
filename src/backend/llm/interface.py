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
  TRACKER_LLM_STRUCTURED       — Structured-output strategy (default "auto"):
                                   "auto"        — try the best structured method
                                     first; fall back automatically on HTTP 4xx
                                     indicating unsupported param.
                                   "json_schema" — OpenAI json_schema response_format
                                     (or guided_json for vLLM). Forces strict mode
                                     on compatible servers. Falls back to
                                     json_object on rejection.
                                   "tool"        — Anthropic forced-tool-use only.
                                     Falls back to prefill+text on rejection.
                                   "off"         — disable all structured-output
                                     mechanisms; use json_object (openai) or
                                     prefill (anthropic) only.

Wire format (per dialect + strategy):
  openai — Chat Completions:
    POST {TRACKER_LLM_ENDPOINT}/chat/completions
    Headers: Authorization: Bearer <key>, Content-Type: application/json

    Strategy "auto" / "json_schema":
      Body includes response_format={"type":"json_schema","json_schema":{...strict schema...}}
      On HTTP 4xx with "unsupported" / "invalid" in error body → fall back to
      json_object mode automatically.

    Strategy "off" / fallback:
      Body includes response_format={"type":"json_object"}
      Schema is described in the system prompt as text (existing behaviour).

    Response: choices[0].message.content  (JSON string → parse → unwrap "report")

  anthropic — Messages API:
    POST {TRACKER_LLM_ENDPOINT}/messages
    Headers: x-api-key: <key>, anthropic-version: <version>,
             Content-Type: application/json

    Strategy "auto" / "tool":
      Body includes `tools` (one tool: emit_report with input_schema=report_schema)
      and `tool_choice={"type":"tool","name":"emit_report"}`.
      Report is read from content[?].type=="tool_use" block's `input` field.
      On HTTP 4xx → fall back to prefill+text mode automatically.

    Strategy "off" / fallback:
      Assistant prefill `{` + text extraction (existing behaviour).

    Response: tool_use.input dict  OR  content[0].text (prefill reconstruction)

OpenAI strict-schema derivation:
  OpenAI json_schema strict:true requires every object to have
  additionalProperties:false and ALL its property keys listed in `required`.
  Our report_schema.json intentionally does not satisfy this (optional fields
  are omitted from `required`; taskEntry / artifactEntry use `oneOf` which is
  unsupported by strict mode).
  We derive a strict-compatible schema at runtime via `_derive_strict_schema()`
  WITHOUT editing report_schema.json:
    * All object properties are added to `required`.
    * `oneOf` is dropped from taskEntry / artifactEntry; all properties become
      nullable (type becomes [original_type, "null"]) to preserve optionality.
    * `$schema`, `$id`, `format`, `default` meta-keywords are stripped (not in
      the strict subset).
    * `$defs` and `$ref` are kept — they ARE supported in strict mode.
    * `description` is kept.

Design decisions:
  * All four config vars (provider/endpoint/api_key/model) are required. Blank ⇒
    LLMNotConfiguredError, not a silent default.
  * No SDK dependency — stdlib urllib only.
  * Fallback ladder: structured → json_object/prefill → text+extract.
  * Fallback is automatic on HTTP 4xx (unsupported param) from the server.
  * anthropic-version default: "2023-06-01" (minimum stable version for the
    Messages API). Overridable via TRACKER_LLM_ANTHROPIC_VERSION.
"""

from __future__ import annotations

import copy
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
_STRUCTURED_ENV = "TRACKER_LLM_STRUCTURED"

# Provider identifiers
_PROVIDER_OPENAI = "openai"
_PROVIDER_ANTHROPIC = "anthropic"

# Structured-output strategy values
_STRATEGY_AUTO = "auto"
_STRATEGY_JSON_SCHEMA = "json_schema"
_STRATEGY_TOOL = "tool"
_STRATEGY_OFF = "off"
_VALID_STRATEGIES = (_STRATEGY_AUTO, _STRATEGY_JSON_SCHEMA, _STRATEGY_TOOL, _STRATEGY_OFF)

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


def _structured_strategy() -> str:
    """Return the structured-output strategy from TRACKER_LLM_STRUCTURED.

    Valid values: auto, json_schema, tool, off.  Defaults to "auto".
    Unknown values are silently treated as "auto".
    """
    val = os.environ.get(_STRUCTURED_ENV, "").strip().lower()
    if val in _VALID_STRATEGIES:
        return val
    return _STRATEGY_AUTO


def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Strict-schema derivation (OpenAI json_schema strict:true compatibility)
# ---------------------------------------------------------------------------

def _derive_strict_schema(schema: dict) -> dict:
    """Derive an OpenAI strict-mode-compatible schema from report_schema.json
    WITHOUT modifying the source file.

    OpenAI json_schema strict:true imposes these constraints on the schema
    passed in `json_schema.schema`:
      1. Every object node must have `additionalProperties: false`.
      2. Every object node must list ALL its property keys in `required`
         (optional fields are expressed by making their type nullable, e.g.
         `["string", "null"]`).
      3. Only a specific subset of JSON Schema keywords is recognised:
         type, enum, properties, required, additionalProperties, $ref, $defs,
         items, description, anyOf.  Keywords outside this set are ignored or
         cause rejection: $schema, $id, format, default, title, oneOf.
      4. `oneOf` is NOT in the supported subset.  We convert taskEntry and
         artifactEntry's oneOf (which encodes mutual-exclusion of task/new_task
         and artifact/new_artifact) by dropping the oneOf clause and making all
         fields nullable.  The mutual-exclusion constraint is enforced by the
         Pydantic ReportDocument validation after the LLM response is parsed.

    Returns a deep copy of the schema with the above transformations applied.
    This function does NOT touch report_schema.json on disk.
    """
    schema = copy.deepcopy(schema)

    # Strip top-level meta-keywords unsupported by strict mode
    for key in ("$schema", "$id", "title", "description"):
        schema.pop(key, None)

    _strict_transform_node(schema)
    return schema


def _strict_make_nullable(type_val):
    """Return a nullable version of a JSON Schema type value.

    If the type is already ["...", "null"] or includes "null", return as-is.
    Otherwise wrap the existing type in an array with "null".
    """
    if isinstance(type_val, list):
        if "null" not in type_val:
            return type_val + ["null"]
        return type_val
    # type_val is a string like "string", "integer", "object", "array"
    return [type_val, "null"]


def _strict_transform_node(node: dict) -> None:
    """Recursively transform a schema node in-place for strict-mode compatibility."""

    # Strip unsupported / ignored keywords at every level
    for key in ("$schema", "$id", "format", "default", "title"):
        node.pop(key, None)

    node_type = node.get("type")

    if node_type == "object" or "properties" in node:
        # Ensure additionalProperties: false (already present in our schema,
        # but be explicit so subschemas added later also get it).
        node["additionalProperties"] = False

        props = node.get("properties", {})
        existing_required = set(node.get("required", []))

        # Build a new required list: ALL property keys, making optional ones
        # nullable so the model can omit them by returning null.
        new_required = []
        for prop_name, prop_schema in props.items():
            new_required.append(prop_name)
            if prop_name not in existing_required:
                # Make optional property nullable
                if "type" in prop_schema:
                    prop_schema["type"] = _strict_make_nullable(prop_schema["type"])
                elif "$ref" in prop_schema:
                    # Cannot make a $ref nullable directly in strict mode without
                    # anyOf; wrap it as anyOf: [{$ref:...}, {type:"null"}].
                    # anyOf IS in the strict subset (unlike oneOf).
                    ref = prop_schema.pop("$ref")
                    prop_schema["anyOf"] = [{"$ref": ref}, {"type": "null"}]
                # If neither type nor $ref (e.g. only description), leave as-is

        node["required"] = new_required

        # Drop oneOf / allOf / not — not in the strict subset.
        # For taskEntry / artifactEntry the oneOf encodes which of
        # task/new_task and artifact/new_artifact is present; we express this
        # by keeping all fields nullable (handled above) and relying on
        # post-parse Pydantic validation.
        for combiner in ("oneOf", "allOf", "not"):
            node.pop(combiner, None)

        # Recurse into property sub-schemas
        for prop_schema in props.values():
            if isinstance(prop_schema, dict):
                _strict_transform_node(prop_schema)

    elif node_type == "array" or "items" in node:
        # Recurse into items
        items = node.get("items")
        if isinstance(items, dict):
            _strict_transform_node(items)

    # Recurse into $defs
    if "$defs" in node:
        for def_schema in node["$defs"].values():
            if isinstance(def_schema, dict):
                _strict_transform_node(def_schema)

    # Recurse into anyOf (which we may have just created above, or which existed)
    if "anyOf" in node:
        for sub in node["anyOf"]:
            if isinstance(sub, dict):
                _strict_transform_node(sub)


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

# System prompt variant for tool-use (no schema-in-prompt needed, schema is
# provided as the tool's input_schema, but we still give instructions).
_SYSTEM_PROMPT_TOOL_TEMPLATE = """\
You are a structured-report assistant for an AI adoption tracking tool.
Given raw meeting notes and context about a champion's existing domains,
tasks, and artifacts, you produce a structured JSON report by calling the
`emit_report` tool.

Rules:
- Call the `emit_report` tool exactly once with the complete report as its argument.
- Map notes onto existing tasks and artifacts using the names in `context`.
- De-duplicate: if the same task appears multiple times in the notes, emit it once.
- Use `task` (existing name) vs `new_task` (brand-new) as the schema requires.
- Use `artifact` (existing name) vs `new_artifact` (brand-new) as the schema requires.
- Rephrase raw note language into clean, concise field values.
- `raw_notes` MUST contain the original notes verbatim.
- `meeting_date` MUST be an ISO-8601 date (YYYY-MM-DD).
- Only include domain `changes` fields that actually changed in this meeting.
"""


def _build_prompts(notes: str, context: dict) -> tuple[str, str]:
    schema = _load_schema()
    system = _SYSTEM_PROMPT_TEMPLATE.format(schema=json.dumps(schema, indent=2))
    user = _USER_PROMPT_TEMPLATE.format(
        context=json.dumps(context, indent=2, ensure_ascii=False),
        notes=notes,
    )
    return system, user


def _build_tool_prompts(notes: str, context: dict) -> tuple[str, str]:
    """Build prompts for tool-use mode (system prompt omits the raw schema)."""
    system = _SYSTEM_PROMPT_TOOL_TEMPLATE
    user = _USER_PROMPT_TEMPLATE.format(
        context=json.dumps(context, indent=2, ensure_ascii=False),
        notes=notes,
    )
    return system, user


# ---------------------------------------------------------------------------
# HTTP transport helper
# ---------------------------------------------------------------------------

def _http_post(url: str, headers: dict, payload: bytes, timeout: float) -> bytes:
    """POST payload to url; return response bytes.

    Raises:
      urllib.error.HTTPError  — non-2xx response (caller may inspect .code).
      urllib.error.URLError   — transport-level failure.
    """
    req = urllib.request.Request(url, data=payload, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _is_unsupported_param_error(exc: urllib.error.HTTPError) -> bool:
    """Return True if this HTTP error looks like 'unsupported parameter' rejection.

    OSS servers (vLLM, llama.cpp, TGI) typically return HTTP 400 with an error
    body containing "unsupported", "invalid", "not supported", or "unknown" when
    they don't recognise response_format.json_schema or the tools field.
    We use this to trigger automatic fallback rather than raising LLMRequestError.
    """
    if exc.code not in (400, 422):
        return False
    try:
        body = exc.read().decode("utf-8", errors="replace").lower() if exc.fp else ""
    except Exception:
        body = ""
    indicators = ("unsupported", "invalid", "not supported", "unknown", "unrecognized",
                  "not implemented", "bad request")
    return any(ind in body for ind in indicators)


# ---------------------------------------------------------------------------
# OpenAI-dialect call implementations
# ---------------------------------------------------------------------------

def _openai_headers(api_key: str) -> dict:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


def _openai_parse_response(body: bytes) -> str:
    """Parse OpenAI chat completions response; return content string."""
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


def _call_openai_json_schema(
    api_key: str, model: str, base_url: str, system: str, user: str
) -> str:
    """POST with response_format=json_schema (strict structured output).

    Sends the strict-compatible schema derived from report_schema.json.
    Raises urllib.error.HTTPError on non-2xx so the caller can catch and
    fall back to json_object mode.
    """
    strict_schema = _derive_strict_schema(_load_schema())
    url = f"{base_url}/chat/completions"
    payload = json.dumps({
        "model": model,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "report",
                "schema": strict_schema,
                "strict": True,
            },
        },
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }).encode("utf-8")
    body = _http_post(url, _openai_headers(api_key), payload, _timeout())
    return _openai_parse_response(body)


def _call_openai_json_object(
    api_key: str, model: str, base_url: str, system: str, user: str
) -> str:
    """POST with response_format=json_object (plain JSON mode, schema in prompt).

    This is the existing Wave-1 behaviour, now used as a fallback.
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
    try:
        body = _http_post(url, _openai_headers(api_key), payload, _timeout())
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise LLMRequestError(
            f"Inference server (openai dialect) returned HTTP {exc.code}: {error_body[:300]}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMRequestError(
            f"Inference server (openai dialect) request failed: {exc}"
        ) from exc
    return _openai_parse_response(body)


def _call_openai(
    api_key: str, model: str, base_url: str, system: str, user: str, strategy: str
) -> str:
    """Dispatch OpenAI-dialect call with the configured strategy + fallback ladder.

    Fallback ladder (per strategy):
      auto / json_schema:
        1. Try json_schema strict → on HTTP 4xx unsupported → fall back to
        2. json_object (schema in prompt)
      off:
        1. json_object only (schema in prompt, no structured output)
    """
    if strategy in (_STRATEGY_AUTO, _STRATEGY_JSON_SCHEMA):
        # Attempt schema-constrained decoding first
        try:
            return _call_openai_json_schema(api_key, model, base_url, system, user)
        except urllib.error.HTTPError as exc:
            if _is_unsupported_param_error(exc):
                # Server doesn't support json_schema → fall through to json_object
                pass
            else:
                error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                raise LLMRequestError(
                    f"Inference server (openai dialect) returned HTTP {exc.code}: "
                    f"{error_body[:300]}"
                ) from exc
        except urllib.error.URLError as exc:
            raise LLMRequestError(
                f"Inference server (openai dialect) request failed: {exc}"
            ) from exc
        # Fallback: json_object with schema in system prompt
        return _call_openai_json_object(api_key, model, base_url, system, user)

    # strategy == "off" (or unrecognised): use json_object directly
    return _call_openai_json_object(api_key, model, base_url, system, user)


# ---------------------------------------------------------------------------
# Anthropic-dialect call implementations
# ---------------------------------------------------------------------------

def _anthropic_headers(api_key: str) -> dict:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-api-key": api_key,
        "anthropic-version": _anthropic_version(),
    }


def _call_anthropic_tool(
    api_key: str, model: str, base_url: str, system: str, user: str
) -> dict:
    """POST with forced tool-use (emit_report tool with input_schema=report_schema).

    Returns the tool_use.input dict directly — no JSON parsing needed, the
    server guarantees the input is a valid object matching input_schema.

    Raises urllib.error.HTTPError so the caller can catch and fall back.
    """
    raw_schema = _load_schema()
    url = f"{base_url}/messages"
    payload = json.dumps({
        "model": model,
        "max_tokens": _ANTHROPIC_MAX_TOKENS,
        "system": system,
        "tools": [
            {
                "name": "emit_report",
                "description": (
                    "Emit the structured weekly report. Call this exactly once "
                    "with the complete report object conforming to the schema."
                ),
                "input_schema": raw_schema,
            }
        ],
        "tool_choice": {"type": "tool", "name": "emit_report"},
        "messages": [
            {"role": "user", "content": user},
        ],
    }).encode("utf-8")

    body = _http_post(url, _anthropic_headers(api_key), payload, _timeout())

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise LLMRequestError(
            "Inference server (anthropic tool-use) returned non-JSON response"
        ) from exc

    # Find the tool_use block in the content array
    content = data.get("content", [])
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tool_input = block.get("input")
            if isinstance(tool_input, dict):
                return tool_input
            raise LLMRequestError(
                "Anthropic tool_use block has no dict `input` field: "
                f"{str(block)[:300]}"
            )

    raise LLMRequestError(
        f"Anthropic response contained no tool_use block: {str(data)[:300]}"
    )


def _call_anthropic_prefill(
    api_key: str, model: str, base_url: str, system: str, user: str
) -> str:
    """POST with assistant `{` prefill; return reconstructed JSON string.

    This is the existing Wave-1 behaviour used as a fallback when the server
    does not support forced tool-use.

    Prefill-echo-tolerant reconstruction:
      1. Build candidate = "{" + continuation
      2. If valid JSON → use it (compliant server path).
      3. Else if continuation starts with "{" → use as-is (echo-server path).
      4. Either way, _extract_json handles fence/brace fallback.
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
    try:
        body = _http_post(url, _anthropic_headers(api_key), payload, _timeout())
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

    # Prefill-echo-tolerant reconstruction (see module docstring).
    candidate = "{" + continuation
    try:
        json.loads(candidate)
        return candidate
    except json.JSONDecodeError:
        if continuation.lstrip().startswith("{"):
            return continuation
        return candidate


def _call_anthropic(
    api_key: str, model: str, base_url: str, system: str, user: str, strategy: str
) -> tuple[dict | None, str | None]:
    """Dispatch Anthropic-dialect call with the configured strategy + fallback ladder.

    Returns a 2-tuple: (tool_dict, raw_str).  Exactly one is non-None:
      tool_dict — non-None when tool-use succeeded; a fully-parsed dict,
                  no further JSON parsing required.
      raw_str   — non-None when prefill path was used; a raw string to pass
                  through _extract_json / _unwrap_report.

    Fallback ladder (per strategy):
      auto / tool:
        1. Try forced tool-use → on HTTP 4xx unsupported → fall back to
        2. Prefill + text extraction
      off:
        1. Prefill only
    """
    if strategy in (_STRATEGY_AUTO, _STRATEGY_TOOL):
        try:
            tool_system, tool_user = _build_tool_prompts(
                # We pass the raw prompts here but need notes/context — see
                # the caller _call_anthropic_dispatch which handles this.
                "", {}
            )
        except Exception:
            pass

        # Attempt forced tool-use
        try:
            result_dict = _call_anthropic_tool(api_key, model, base_url, system, user)
            return result_dict, None
        except urllib.error.HTTPError as exc:
            if _is_unsupported_param_error(exc):
                # Server doesn't support tools → fall through to prefill
                pass
            else:
                error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                raise LLMRequestError(
                    f"Inference server (anthropic dialect) returned HTTP {exc.code}: "
                    f"{error_body[:300]}"
                ) from exc
        except urllib.error.URLError as exc:
            raise LLMRequestError(
                f"Inference server (anthropic dialect) request failed: {exc}"
            ) from exc
        # Fallback: prefill + text extraction (build schema-in-prompt version)
        # We need the schema-in-prompt system prompt for the fallback
        return None, _call_anthropic_prefill(api_key, model, base_url, system, user)

    # strategy == "off": prefill only
    return None, _call_anthropic_prefill(api_key, model, base_url, system, user)


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

    Structured-output strategy is controlled by TRACKER_LLM_STRUCTURED (default
    "auto"). See module docstring for the full fallback ladder per dialect.

    Raises:
      LLMNotConfiguredError — ANY of provider/endpoint/api_key/model is unset or blank.
      LLMRequestError       — all four vars present but call failed (transport,
                              HTTP error, or unparseable/non-object response).
    """
    provider = _provider()    # raises LLMNotConfiguredError if unset/invalid
    api_key = _api_key()      # raises LLMNotConfiguredError if unset/blank
    model = _model()          # raises LLMNotConfiguredError if unset/blank
    base_url = _base_url()    # raises LLMNotConfiguredError if unset/blank
    strategy = _structured_strategy()

    if provider == _PROVIDER_OPENAI:
        # Build schema-in-prompt prompts for fallback; json_schema path uses
        # the same prompts (schema is also in prompt as a belt-and-suspenders
        # guide, and the response_format constraint enforces the shape).
        system, user = _build_prompts(notes, context)
        raw = _call_openai(api_key, model, base_url, system, user, strategy)
        data = _extract_json(raw)
        return _unwrap_report(data)

    else:  # anthropic
        if strategy in (_STRATEGY_AUTO, _STRATEGY_TOOL):
            # Tool-use path: use the tool-specific system prompt (no raw schema
            # in prompt — the schema is the tool's input_schema).
            tool_system, tool_user = _build_tool_prompts(notes, context)
            # Fallback prefill path needs the schema-in-prompt version.
            fallback_system, fallback_user = _build_prompts(notes, context)

            try:
                result_dict = _call_anthropic_tool(
                    api_key, model, base_url, tool_system, tool_user
                )
                # Tool-use returns a fully-parsed dict; unwrap if needed.
                return _unwrap_report(result_dict)
            except urllib.error.HTTPError as exc:
                if _is_unsupported_param_error(exc):
                    # Fall back to prefill
                    raw = _call_anthropic_prefill(
                        api_key, model, base_url, fallback_system, fallback_user
                    )
                    data = _extract_json(raw)
                    return _unwrap_report(data)
                else:
                    error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
                    raise LLMRequestError(
                        f"Inference server (anthropic dialect) returned HTTP {exc.code}: "
                        f"{error_body[:300]}"
                    ) from exc
            except urllib.error.URLError as exc:
                raise LLMRequestError(
                    f"Inference server (anthropic dialect) request failed: {exc}"
                ) from exc
        else:
            # strategy == "off": prefill only
            system, user = _build_prompts(notes, context)
            raw = _call_anthropic_prefill(api_key, model, base_url, system, user)
            data = _extract_json(raw)
            return _unwrap_report(data)
