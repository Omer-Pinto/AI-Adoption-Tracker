"""LLM drafting adapter — air-gapped open model, schema-enforced structured outputs.

Design
------
This module is the sole seam between the AI Adoption Tracker backend and a
self-hosted (air-gapped) open model.  There is no public internet, no vendor
cloud; ``TRACKER_LLM_ENDPOINT`` always points at the operator's own server.

Two wire dialects are supported, selected by ``TRACKER_LLM_PROVIDER``:

OpenAI-compatible dialect
    POST to ``<endpoint>/chat/completions`` with the OpenAI Chat Completions
    schema.  Structured output is enforced via ``response_format`` with
    ``type="json_schema"`` and ``strict=true``, which instructs the server's
    constrained-decoding layer to guarantee that every token sequence it emits
    is a valid instance of our report schema.  Because OpenAI's strict subset
    disallows ``oneOf``/``anyOf``/$ref chains and requires ``additionalProperties:
    false`` on every object, the schema stored in ``report_schema.json`` is
    transformed at runtime into a strict-compatible form before being sent.
    The report dict is read from ``response["choices"][0]["message"]["content"]``
    after JSON-parsing.

Anthropic-compatible dialect
    POST to ``<endpoint>/messages`` with the Anthropic Messages API schema.
    Structured output is enforced via *forced tool use*: a single tool whose
    ``input_schema`` is our (unmodified) report schema is registered, and
    ``tool_choice`` is set to force the model to call exactly that tool.  The
    structured report is read directly from the ``tool_use`` content block's
    ``input`` field — no JSON parsing of a string is needed.

No fallback ladder, no degraded mode.  If the server cannot honour the
structured-output request the call raises ``LLMRequestError`` immediately.

Configuration (all four required — blank ⇒ ``LLMNotConfiguredError``)
----------------------------------------------------------------------
TRACKER_LLM_PROVIDER   ``openai`` or ``anthropic``
TRACKER_LLM_ENDPOINT   Full base URL of the air-gapped server (no default)
TRACKER_LLM_API_KEY    Credential for the server (Bearer / x-api-key)
TRACKER_LLM_MODEL      Model name as the server expects it (no default)
TRACKER_LLM_TIMEOUT    Request timeout in seconds (optional, default 120)

Public contract (callers: routes/reports.py)
--------------------------------------------
draft_report(notes: str, context: dict) -> dict
    Returns a dict shaped like ``report_schema.json`` / ``models.ReportDocument``.
    Raises ``LLMNotConfiguredError`` when any required config var is unset/blank
    (routes maps this to HTTP 503).
    Raises ``LLMRequestError`` when the call is configured but fails at the
    transport, HTTP, or parse level (routes maps this to HTTP 502).
"""

from __future__ import annotations

import copy
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Config keys
# ---------------------------------------------------------------------------
_ENV_PROVIDER = "TRACKER_LLM_PROVIDER"
_ENV_ENDPOINT = "TRACKER_LLM_ENDPOINT"
_ENV_API_KEY = "TRACKER_LLM_API_KEY"
_ENV_MODEL = "TRACKER_LLM_MODEL"
_ENV_TIMEOUT = "TRACKER_LLM_TIMEOUT"
_DEFAULT_TIMEOUT = 120.0

_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "report_schema.json"

# Anthropic Messages API version header — required by the wire format.
_ANTHROPIC_API_VERSION = "2023-06-01"


# ---------------------------------------------------------------------------
# Public exception types (names are part of the public contract)
# ---------------------------------------------------------------------------


class LLMNotConfiguredError(RuntimeError):
    """Raised when any required config variable is unset or blank.

    The reports route maps this to HTTP 503 ("LLM not configured") so the UI
    can instruct the operator to wire the air-gapped endpoint before creating
    reports.
    """

    def __init__(self, message: str = "LLM endpoint not configured") -> None:
        super().__init__(message)


class LLMRequestError(RuntimeError):
    """Raised when the endpoint is configured but the call fails.

    Covers transport errors (connection refused, timeout), non-2xx HTTP
    responses, and responses that cannot be parsed into the expected shape.
    The reports route maps this to HTTP 502.
    """


# ---------------------------------------------------------------------------
# Config resolution
# ---------------------------------------------------------------------------


def _require_env(key: str) -> str:
    """Return the value of *key*, or raise ``LLMNotConfiguredError`` if blank."""
    value = os.environ.get(key, "").strip()
    if not value:
        raise LLMNotConfiguredError(
            f"Required configuration variable {key!r} is not set. "
            "Set all four TRACKER_LLM_* variables before drafting reports."
        )
    return value


def _timeout() -> float:
    raw = os.environ.get(_ENV_TIMEOUT, "").strip()
    if not raw:
        return _DEFAULT_TIMEOUT
    try:
        return float(raw)
    except ValueError:
        return _DEFAULT_TIMEOUT


def _load_config() -> tuple[str, str, str, str, float]:
    """Resolve and validate all required config vars in one pass.

    Returns (provider, endpoint, api_key, model, timeout).
    Raises ``LLMNotConfiguredError`` for the first missing/blank var found.
    """
    provider = _require_env(_ENV_PROVIDER).lower()
    if provider not in ("openai", "anthropic"):
        raise LLMNotConfiguredError(
            f"TRACKER_LLM_PROVIDER must be 'openai' or 'anthropic', got {provider!r}."
        )
    endpoint = _require_env(_ENV_ENDPOINT).rstrip("/")
    api_key = _require_env(_ENV_API_KEY)
    model = _require_env(_ENV_MODEL)
    return provider, endpoint, api_key, model, _timeout()


# ---------------------------------------------------------------------------
# Schema loading and OpenAI strict-mode transform
# ---------------------------------------------------------------------------


def _load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


def _inline_refs(schema: dict, defs: dict) -> dict:
    """Recursively replace all ``$ref`` values with their inlined definitions.

    Operates on a deep copy — the source schema is never mutated.
    """
    if "$ref" in schema:
        ref: str = schema["$ref"]
        # We only support local $defs refs: "#/$defs/<name>"
        if ref.startswith("#/$defs/"):
            def_name = ref[len("#/$defs/"):]
            if def_name not in defs:
                raise LLMRequestError(
                    f"report_schema.json contains unresolvable $ref: {ref!r}"
                )
            # Inline and recurse so nested $refs are also resolved.
            return _inline_refs(copy.deepcopy(defs[def_name]), defs)
        # Unexpected ref format — surface it rather than silently ignore.
        raise LLMRequestError(
            f"report_schema.json contains unsupported $ref format: {ref!r}"
        )

    result: dict = {}
    for key, value in schema.items():
        if key == "$defs":
            # Strip $defs from child objects — resolved refs no longer need it.
            continue
        if isinstance(value, dict):
            result[key] = _inline_refs(value, defs)
        elif isinstance(value, list):
            result[key] = [
                _inline_refs(item, defs) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            result[key] = value
    return result


def _strip_unsupported_keywords(schema: Any) -> Any:
    """Remove JSON Schema keywords that OpenAI strict mode does not support.

    OpenAI's strict subset rejects: ``oneOf``, ``anyOf``, ``allOf``, ``not``,
    ``if``/``then``/``else``, ``$schema``, ``$id``, ``format``, ``default``,
    ``description`` (kept — harmless), ``title`` (kept — harmless).

    For ``oneOf`` on ``taskEntry`` and ``artifactEntry`` (which encode mutual
    exclusivity between ``task``/``new_task`` and ``artifact``/``new_artifact``),
    the correct transform is to keep all properties and make them individually
    optional.  The semantic constraint is carried in the system prompt instead;
    the schema enforces the *shape*, and the model instruction enforces the
    *mutual-exclusivity* rule.
    """
    _UNSUPPORTED = frozenset({
        "oneOf", "anyOf", "allOf", "not",
        "if", "then", "else",
        "$schema", "$id",
        "format", "default",
    })

    if isinstance(schema, list):
        return [_strip_unsupported_keywords(item) for item in schema]

    if not isinstance(schema, dict):
        return schema

    result: dict = {}
    for key, value in schema.items():
        if key in _UNSUPPORTED:
            continue
        result[key] = _strip_unsupported_keywords(value)

    # OpenAI strict requires additionalProperties: false on every object node.
    if result.get("type") == "object" and "additionalProperties" not in result:
        result["additionalProperties"] = False

    return result


def _to_openai_strict_schema(source: dict) -> dict:
    """Derive an OpenAI-strict-compatible schema from ``report_schema.json``.

    Steps (all applied to a deep copy — source is never mutated):
    1. Extract the ``$defs`` map.
    2. Recursively inline every ``$ref`` so no references remain.
    3. Strip keywords OpenAI strict mode rejects (``oneOf``, ``anyOf``, etc.).
    4. Promote ``$defs`` removal from the root.
    5. Wrap in the ``json_schema`` envelope OpenAI expects.

    The ``name`` field in the envelope must be a simple identifier; we use
    ``weekly_report`` to match the schema's semantic identity.
    """
    defs = source.get("$defs", {})
    inlined = _inline_refs(copy.deepcopy(source), defs)
    # $defs at root level is now redundant (all refs resolved); remove it.
    inlined.pop("$defs", None)
    clean = _strip_unsupported_keywords(inlined)
    # Ensure root object also has additionalProperties: false (may have been
    # present already, but enforce it explicitly).
    clean["additionalProperties"] = False
    return {
        "name": "weekly_report",
        "strict": True,
        "schema": clean,
    }


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------


def _post_json(url: str, headers: dict[str, str], payload: dict, timeout: float) -> dict:
    """POST *payload* as JSON to *url*, return the parsed response body dict.

    Raises ``LLMRequestError`` for any transport, HTTP, or parse failure.
    """
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        **headers,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        # Read the response body for the server's error message when available.
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            err_body = "(unreadable)"
        raise LLMRequestError(
            f"LLM server returned HTTP {exc.code}: {err_body}"
        ) from exc
    except urllib.error.URLError as exc:
        raise LLMRequestError(
            f"LLM server unreachable: {exc.reason}"
        ) from exc

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise LLMRequestError(
            "LLM server returned a non-JSON response body"
        ) from exc

    if not isinstance(data, dict):
        raise LLMRequestError(
            f"LLM server response is not a JSON object (got {type(data).__name__})"
        )
    return data


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a structured-data extraction assistant for an AI Adoption Tracker.
Given raw meeting notes and a context object describing the champion's current \
state (domains, tasks, artifacts), extract and return a weekly report conforming \
exactly to the provided JSON schema.

Rules:
- champion: copy from context["champion_name"].
- meeting_date: today's date in YYYY-MM-DD, or extract from the notes if stated.
- raw_notes: copy the notes verbatim.
- For tasks: use the "task" field when the task name already exists in context, \
use "new_task" when it is brand new. Use exactly one of the two, never both.
- For artifacts: same pattern — "artifact" for existing, "new_artifact" for new. \
Use exactly one of the two, never both.
- Only include domain sections that are actually mentioned in the notes.
- Omit optional fields that have no value rather than emitting null or empty strings.\
"""


# ---------------------------------------------------------------------------
# OpenAI-compatible dialect
# ---------------------------------------------------------------------------


def _draft_openai(
    notes: str,
    context: dict,
    endpoint: str,
    api_key: str,
    model: str,
    timeout: float,
) -> dict:
    """Call the OpenAI-compatible chat-completions endpoint with json_schema output.

    Structured output is enforced via::

        response_format = {
            "type": "json_schema",
            "json_schema": {"name": "weekly_report", "strict": True, "schema": ...}
        }

    The server's constrained-decoding layer guarantees the output conforms to the
    schema; no post-hoc repair or fallback is attempted.

    The report dict is extracted from::

        response["choices"][0]["message"]["content"]  (a JSON string → parsed)
    """
    source_schema = _load_schema()
    strict_schema = _to_openai_strict_schema(source_schema)

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Context (champion state):\n{json.dumps(context, indent=2)}\n\n"
                    f"Meeting notes:\n{notes}"
                ),
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": strict_schema,
        },
    }

    data = _post_json(
        f"{endpoint}/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        payload,
        timeout,
    )

    # Extract content from the first choice.
    try:
        content_str: str = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMRequestError(
            f"OpenAI-dialect response missing expected structure: {exc}"
        ) from exc

    if not isinstance(content_str, str):
        raise LLMRequestError(
            f"OpenAI-dialect 'content' field is not a string (got {type(content_str).__name__})"
        )

    try:
        report = json.loads(content_str)
    except json.JSONDecodeError as exc:
        raise LLMRequestError(
            f"OpenAI-dialect 'content' field is not valid JSON: {exc}"
        ) from exc

    if not isinstance(report, dict):
        raise LLMRequestError(
            f"OpenAI-dialect structured output is not a JSON object (got {type(report).__name__})"
        )
    return report


# ---------------------------------------------------------------------------
# Anthropic-compatible dialect
# ---------------------------------------------------------------------------


def _draft_anthropic(
    notes: str,
    context: dict,
    endpoint: str,
    api_key: str,
    model: str,
    timeout: float,
) -> dict:
    """Call the Anthropic-compatible messages endpoint with forced tool use.

    Structured output is enforced via the Anthropic forced-tool-use pattern::

        tools = [{"name": "submit_report", "input_schema": <report_schema.json>}]
        tool_choice = {"type": "tool", "name": "submit_report"}

    The server is forced to call the ``submit_report`` tool, which means it must
    emit JSON that validates against ``input_schema`` (our unmodified report
    schema).  No transformation of the schema is needed for this dialect.

    The report dict is read directly from the ``tool_use`` content block::

        next(b for b in response["content"] if b["type"] == "tool_use")["input"]

    ``input`` is already a parsed dict — no JSON string parsing is needed.
    """
    tool_schema = _load_schema()
    # Anthropic input_schema must not contain $schema/$id meta-keywords.
    tool_input_schema = {
        k: v for k, v in tool_schema.items()
        if k not in ("$schema", "$id", "title", "description")
    }

    payload = {
        "model": model,
        "max_tokens": 4096,
        "system": _SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": (
                    f"Context (champion state):\n{json.dumps(context, indent=2)}\n\n"
                    f"Meeting notes:\n{notes}"
                ),
            }
        ],
        "tools": [
            {
                "name": "submit_report",
                "description": (
                    "Submit the structured weekly report extracted from the meeting notes."
                ),
                "input_schema": tool_input_schema,
            }
        ],
        "tool_choice": {"type": "tool", "name": "submit_report"},
    }

    data = _post_json(
        f"{endpoint}/messages",
        {
            "x-api-key": api_key,
            "anthropic-version": _ANTHROPIC_API_VERSION,
        },
        payload,
        timeout,
    )

    # Find the tool_use block in the response content list.
    content_blocks = data.get("content")
    if not isinstance(content_blocks, list):
        raise LLMRequestError(
            "Anthropic-dialect response missing 'content' list"
        )

    tool_use_block = next(
        (b for b in content_blocks if isinstance(b, dict) and b.get("type") == "tool_use"),
        None,
    )
    if tool_use_block is None:
        # The model did not call the tool despite tool_choice forcing it —
        # surface this as a hard error; do not attempt text extraction.
        stop_reason = data.get("stop_reason", "unknown")
        raise LLMRequestError(
            f"Anthropic-dialect response contains no tool_use block "
            f"(stop_reason={stop_reason!r}). The server may not support forced tool use."
        )

    report = tool_use_block.get("input")
    if not isinstance(report, dict):
        raise LLMRequestError(
            f"Anthropic-dialect tool_use 'input' is not a dict "
            f"(got {type(report).__name__})"
        )
    return report


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def draft_report(notes: str, context: dict) -> dict:
    """Draft a structured weekly report from raw meeting notes.

    Sends *notes* and *context* to the configured air-gapped model endpoint
    and returns a dict shaped like ``report_schema.json`` / ``models.ReportDocument``.

    The call is schema-enforced end-to-end: the model is constrained at the
    decoding level (OpenAI dialect) or forced via tool use (Anthropic dialect)
    to emit output that conforms to the report schema.  There is no fallback
    mode; a failed or non-conforming response raises ``LLMRequestError``.

    Args:
        notes:   Raw meeting notes, pasted verbatim by the user.
        context: Champion state hints built by ``reports.build_draft_context``
                 (current domains, tasks, artifacts) to help the model rephrase,
                 de-duplicate, and map notes onto existing entities.

    Returns:
        A dict conforming to ``report_schema.json``.  The caller
        (``routes/reports.py``) validates this against ``ReportDocument``.

    Raises:
        LLMNotConfiguredError: Any required config var is unset or blank.
                               Routes maps this to HTTP 503.
        LLMRequestError:       The call is configured but failed (transport,
                               HTTP error, or unparseable/wrong-shaped response).
                               Routes maps this to HTTP 502.
    """
    provider, endpoint, api_key, model, timeout = _load_config()

    if provider == "openai":
        return _draft_openai(notes, context, endpoint, api_key, model, timeout)
    else:  # provider == "anthropic"  (validated in _load_config)
        return _draft_anthropic(notes, context, endpoint, api_key, model, timeout)
