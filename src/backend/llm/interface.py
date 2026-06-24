"""LLM drafting adapter — vendor SDKs, Pydantic-driven structured outputs.

Design
------
This module is the sole seam between the AI Adoption Tracker backend and the
report-drafting model. Two providers are supported, selected by
``TRACKER_LLM_PROVIDER``:

OpenAI (official ``openai`` SDK)
    ``client.chat.completions.parse(..., response_format=ReportDocument)``.
    The SDK runs OpenAI's own ``to_strict_json_schema`` over the Pydantic model,
    which lists EVERY property of every object in ``required`` and renders truly
    optional fields as nullable (``["string", "null"]`` / ``anyOf`` with null) —
    the exact shape OpenAI Structured Outputs (``strict: true``) demands. We never
    hand-build or hand-transform JSON Schema; the ``ReportDocument`` model is the
    single source of truth. The parsed object comes back as a validated
    ``ReportDocument``; we return its JSON dump.

Anthropic (official ``anthropic`` SDK)
    ``client.messages.create(...)`` with forced tool use: one tool
    ``submit_report`` whose ``input_schema`` is derived from the model via
    ``ReportDocument.model_json_schema()``, and ``tool_choice={"type":"tool",
    "name":"submit_report"}``. Anthropic does not impose OpenAI's all-required
    strict rule, so the model's natural JSON Schema (optionals simply absent from
    ``required``) is used as-is. The report dict is read from the ``tool_use``
    block's ``input``.

No fallback ladder, no degraded mode. A configured-but-failed call raises
``LLMRequestError`` immediately.

Configuration
-------------
TRACKER_LLM_PROVIDER   ``openai`` or ``anthropic``                (required)
TRACKER_LLM_API_KEY    Credential for the provider                (required)
TRACKER_LLM_MODEL      Model name as the provider expects it      (required)
TRACKER_LLM_ENDPOINT   Base URL override (vLLM/Ollama/air-gap).   (OPTIONAL)
                       Blank ⇒ the SDK's hosted default endpoint;
                       set   ⇒ passed to the SDK as ``base_url``.
TRACKER_LLM_TIMEOUT    Request timeout in seconds (default 120).  (optional)

Public contract (callers: routes/reports.py)
--------------------------------------------
draft_report(notes: str, context: dict) -> dict
    Returns a dict shaped like ``models.ReportDocument`` (the route calls
    ``ReportDocument.model_validate(...)`` on it).
    Raises ``LLMNotConfiguredError`` when provider/key/model is unset/blank
    (routes maps this to HTTP 503).
    Raises ``LLMRequestError`` when the call is configured but fails at the
    transport, API, parse, or validation level (routes maps this to HTTP 502).
"""

from __future__ import annotations

import datetime
import json
import os
from typing import Any

from models import ReportDocument
from pydantic import BaseModel as _PydanticBaseModel


# ---------------------------------------------------------------------------
# Pydantic models for domain extraction structured output
# ---------------------------------------------------------------------------

class DomainProposal(_PydanticBaseModel):
    """One proposed domain extracted from free text."""
    name: str
    description: str | None = None
    priority: int | None = None


class DomainExtraction(_PydanticBaseModel):
    """Structured output for the extract_domains call."""
    domains: list[DomainProposal]

# ---------------------------------------------------------------------------
# Config keys
# ---------------------------------------------------------------------------
_ENV_PROVIDER = "TRACKER_LLM_PROVIDER"
_ENV_ENDPOINT = "TRACKER_LLM_ENDPOINT"
_ENV_API_KEY = "TRACKER_LLM_API_KEY"
_ENV_MODEL = "TRACKER_LLM_MODEL"
_ENV_TIMEOUT = "TRACKER_LLM_TIMEOUT"
_DEFAULT_TIMEOUT = 120.0

# Anthropic requires an explicit max_tokens; the report is small but domains can
# fan out, so allow ample room.
_ANTHROPIC_MAX_TOKENS = 4096


# ---------------------------------------------------------------------------
# Public exception types (names are part of the public contract)
# ---------------------------------------------------------------------------


class LLMNotConfiguredError(RuntimeError):
    """Raised when a required config variable is unset or blank.

    The reports route maps this to HTTP 503 ("LLM not configured") so the UI
    can instruct the operator to wire the provider before creating reports.
    """

    def __init__(self, message: str = "LLM provider not configured") -> None:
        super().__init__(message)


class LLMRequestError(RuntimeError):
    """Raised when the provider is configured but the call fails.

    Covers transport/connection errors, non-2xx API responses, and responses
    that cannot be parsed/validated into the expected report shape. The reports
    route maps this to HTTP 502.
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
            "Set TRACKER_LLM_PROVIDER, TRACKER_LLM_API_KEY and TRACKER_LLM_MODEL "
            "before drafting reports."
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


def _optional_base_url() -> str | None:
    """Return the operator-supplied endpoint override, or None for SDK default."""
    value = os.environ.get(_ENV_ENDPOINT, "").strip()
    return value or None


def _load_config() -> tuple[str, str, str, str | None, float]:
    """Resolve and validate config.

    Returns (provider, api_key, model, base_url_or_none, timeout).
    Raises ``LLMNotConfiguredError`` for the first missing/blank required var.
    The endpoint is optional (blank ⇒ SDK default hosted endpoint).
    """
    provider = _require_env(_ENV_PROVIDER).lower()
    if provider not in ("openai", "anthropic"):
        raise LLMNotConfiguredError(
            f"TRACKER_LLM_PROVIDER must be 'openai' or 'anthropic', got {provider!r}."
        )
    api_key = _require_env(_ENV_API_KEY)
    model = _require_env(_ENV_MODEL)
    return provider, api_key, model, _optional_base_url(), _timeout()


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a structured-data extraction assistant for an AI Adoption Tracker.
Given raw meeting notes and a context object describing the champion's current \
state (domains, tasks, artifacts), extract and return a weekly report conforming \
exactly to the provided structured schema.

Rules:
- champion: copy from context["champion_name"].
- meeting_date: extract from the notes if stated; if the notes give only a \
partial date (e.g. "June 16th" with no year), resolve it against the provided \
current date — pick the year that makes the meeting date on or before today. If \
the notes state no date at all, use the provided current date.
- raw_notes: copy the notes verbatim — always, in full, unaltered.
- For tasks: record each task by name in the "task" field, exactly as it appears \
in the notes. Do not decide or mark whether a task is new or already existing — \
that is resolved by the backend against the database.
- For artifacts: record each tool or artifact by name in the "artifact" field, \
exactly as it appears in the notes. Do not decide or mark whether an artifact is \
new or already existing — that is resolved by the backend against the database.
- Only include domain sections that are actually mentioned in the notes.

DOMAINS — use ONLY the ones provided in the context (do not invent):
- The context lists the champion's existing domains (their tech/stack work areas, \
e.g. Backend, Web, Deployment, Monitor & Debug). Use ONLY those domain names. \
NEVER invent a new domain, and NEVER make a domain out of "Claude Code", a meeting \
heading (e.g. "Current Claude Code status"), or the adoption process itself.
- Assign every task and artifact to the existing domain it best fits. If you \
cannot confidently place one, put it in the domain named "General" (always present \
in the context as a catch-all) — the human will reassign it. Do not drop it.

EXISTING vs NEW (tasks & artifacts — the context is the source of truth):
- The context lists the champion's existing tasks and artifacts (with their \
domains). For each task/artifact mentioned in the notes, ASSUME it refers to the \
matching EXISTING one and use that entity's EXACT existing name, so it links to \
the real record instead of creating a duplicate.
- Treat a task/artifact as NEW only when the notes explicitly say so (e.g. "new \
task …", "new skill …", "created a …", "started a new …") OR when nothing in the \
context plausibly matches it. For a new artifact, set its "type".
- Match generously on meaning, not just exact spelling (e.g. "the clutter map" → \
existing task "Clutter map").

GROUPING — one described thing is ONE artifact (do not explode):
- A single item is ONE artifact even when described with several parts. Example: \
"a group of context md files in a router pattern (architecture decisions, \
conventions, a file index, deep-dives)" is ONE artifact of type "context" — NOT \
four; capture the parts in its "note", not as separate artifacts.
- Only a concrete, named tool/skill/agent/hook/context becomes an artifact. Do \
not turn generic mentions, individual file names, or descriptive sub-bullets into \
separate artifacts.

COMPLETENESS — capture every piece of information (do not drop note lines):
- EVERY piece of information in the notes must land somewhere in the output. \
Account for every line. Do not silently drop any item, category, or detail.
- Map each item to the structured field that fits it: a task/status/owner/finish \
date → a "tasks" entry under its domain; a tool/artifact (with its type/tags/ \
change) → an "artifacts" entry under its best-fit existing domain (or "General" if \
unsure); a follow-up or to-do → an \
"action_items" entry (text, and owner/domain/due_date when stated); a person \
present → "participants"; a domain mentioned → a domain section; a domain \
attribute change (description/priority) → that domain's "changes".
- If a line genuinely does not fit any structured field, it MUST STILL be \
captured: put general talking points, context, or progress narrative in \
"discussion", and problems, risks, blockers, or concerns in "issues" — \
whichever fits. Never omit it.
- Do not discard any item. If you are unsure where something belongs, place it \
in "discussion" or "issues" rather than leaving it out.

ARTIFACT TYPE — every artifact entry must have a type:
- Whenever you record an artifact entry, you MUST set its "type" to the best-fit \
value from {agent, skill, hook, context}. A new artifact saved without a type \
fails the backend (422), so an artifact entry must NEVER be emitted without a \
type.
- If the notes state the type, use it. If the notes do NOT state it, infer the \
most likely type from the artifact's name and how it is described, and add a \
short note of that assumption in the entry's "note" field (e.g. "type inferred \
as skill"). Still always set "type" — never leave it null for a new artifact.

NO FABRICATION (reconciled with completeness):
- For fields with no value, use null (or an empty list for list fields) rather \
than inventing data. Never fabricate domains, tasks, artifacts, owners, dates, \
or any fact that is not in the notes.
- "Never fabricate" does NOT mean "omit when unsure". Do not invent facts, but \
also do not drop facts that ARE in the notes: an uncertain PLACEMENT goes to \
"discussion" or "issues" (never the bin), and an uncertain artifact TYPE gets a \
best-fit guess noted in "note" (never omitted). Both rules hold at once.\
"""


def _user_content(notes: str, context: dict) -> str:
    today = datetime.date.today().isoformat()
    return (
        f"Current date (today): {today}\n\n"
        f"Context (champion state):\n{json.dumps(context, indent=2)}\n\n"
        f"Meeting notes:\n{notes}"
    )


# ---------------------------------------------------------------------------
# OpenAI provider
# ---------------------------------------------------------------------------


def _draft_openai(
    notes: str,
    context: dict,
    api_key: str,
    model: str,
    base_url: str | None,
    timeout: float,
) -> dict:
    """Draft via the official ``openai`` SDK with native structured-output parsing.

    ``response_format=ReportDocument`` makes the SDK derive an OpenAI-strict
    JSON Schema from the Pydantic model (every property required, optionals
    nullable) and parse the response back into a validated ``ReportDocument``.
    """
    import openai
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)

    try:
        completion = client.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _user_content(notes, context)},
            ],
            response_format=ReportDocument,
        )
    except (openai.APIConnectionError, openai.APIStatusError, openai.APIError) as exc:
        raise LLMRequestError(f"OpenAI request failed: {exc}") from exc

    message = completion.choices[0].message
    if getattr(message, "refusal", None):
        raise LLMRequestError(f"OpenAI refused to draft the report: {message.refusal}")

    report = message.parsed
    if report is None:
        raise LLMRequestError(
            "OpenAI returned no parsed structured output "
            f"(finish_reason={completion.choices[0].finish_reason!r})."
        )
    return report.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Anthropic provider
# ---------------------------------------------------------------------------


def _draft_anthropic(
    notes: str,
    context: dict,
    api_key: str,
    model: str,
    base_url: str | None,
    timeout: float,
) -> dict:
    """Draft via the official ``anthropic`` SDK with forced tool use.

    The single tool ``submit_report`` carries the model-derived JSON Schema as
    its ``input_schema``; ``tool_choice`` forces the model to call it. The report
    dict is the tool_use block's ``input``, then validated against
    ``ReportDocument`` before return.
    """
    import anthropic
    from pydantic import ValidationError

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url, timeout=timeout)

    input_schema = ReportDocument.model_json_schema()

    try:
        response = client.messages.create(
            model=model,
            max_tokens=_ANTHROPIC_MAX_TOKENS,
            system=_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": _user_content(notes, context)},
            ],
            tools=[
                {
                    "name": "submit_report",
                    "description": (
                        "Submit the structured weekly report extracted from the "
                        "meeting notes."
                    ),
                    "input_schema": input_schema,
                }
            ],
            tool_choice={"type": "tool", "name": "submit_report"},
        )
    except (anthropic.APIConnectionError, anthropic.APIStatusError, anthropic.APIError) as exc:
        raise LLMRequestError(f"Anthropic request failed: {exc}") from exc

    tool_use = next(
        (block for block in response.content if getattr(block, "type", None) == "tool_use"),
        None,
    )
    if tool_use is None:
        raise LLMRequestError(
            "Anthropic response contains no tool_use block "
            f"(stop_reason={response.stop_reason!r}). Forced tool use did not occur."
        )

    raw_report: Any = tool_use.input
    if not isinstance(raw_report, dict):
        raise LLMRequestError(
            f"Anthropic tool_use 'input' is not an object (got {type(raw_report).__name__})."
        )

    # Validate against the same source-of-truth model the OpenAI path returns,
    # so both providers hand the route an identically-shaped, valid dict.
    try:
        report = ReportDocument.model_validate(raw_report)
    except ValidationError as exc:
        raise LLMRequestError(
            f"Anthropic structured output failed report validation: {exc}"
        ) from exc
    return report.model_dump(mode="json")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Domain extraction system prompt
# ---------------------------------------------------------------------------

_DOMAIN_EXTRACT_PROMPT = """\
You are a structured-data extraction assistant for an AI Adoption Tracker.

The input is a short text block that lists a team's TECHNOLOGY / WORK DOMAINS — \
each given as a name, a short description, and (optionally) a stated priority or \
ordering. It is NOT a meeting transcript or planning doc; it is a concise \
enumeration of domains. Your job is to identify those domains — the recurring \
areas of technical ownership such as "Backend", "Web", "Deployment", \
"Monitor & Debug", "Data Platform", etc.

Rules:
- name: a short, clear domain name (2-5 words max).
- description: the tech/scope words that describe what this domain covers \
(key technologies, systems, responsibilities). Keep it concise.
- priority: a plain integer rank (1, 2, 3, …) — 1 being highest priority — \
whenever the text states or implies an ordering (e.g. \
"Priority Order: 1 -> 4 -> 3 -> 2", or domains simply listed in priority order). \
If the text gives no ordering for a domain, use null. NEVER output words or \
labels such as "high", "P1", or "medium"; priority is ALWAYS an integer or null.
- Do NOT invent domains not evidenced in the text.
- Do NOT make "Claude Code", "AI Adoption", or the adoption process itself a domain.
- Return only concrete technical/product work areas the team owns.
- These are PROPOSALS only — nothing is saved.
"""


def _extract_openai(
    text: str,
    api_key: str,
    model: str,
    base_url: str | None,
    timeout: float,
) -> dict:
    """Extract domain proposals via OpenAI structured-output parsing."""
    import openai
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=base_url, timeout=timeout)

    try:
        completion = client.chat.completions.parse(
            model=model,
            messages=[
                {"role": "system", "content": _DOMAIN_EXTRACT_PROMPT},
                {"role": "user", "content": f"Extract domains from:\n\n{text}"},
            ],
            response_format=DomainExtraction,
        )
    except (openai.APIConnectionError, openai.APIStatusError, openai.APIError) as exc:
        raise LLMRequestError(f"OpenAI request failed: {exc}") from exc

    message = completion.choices[0].message
    if getattr(message, "refusal", None):
        raise LLMRequestError(
            f"OpenAI refused to extract domains: {message.refusal}"
        )

    parsed = message.parsed
    if parsed is None:
        raise LLMRequestError(
            "OpenAI returned no parsed structured output "
            f"(finish_reason={completion.choices[0].finish_reason!r})."
        )
    return parsed.model_dump(mode="json")


def _extract_anthropic(
    text: str,
    api_key: str,
    model: str,
    base_url: str | None,
    timeout: float,
) -> dict:
    """Extract domain proposals via Anthropic forced tool use."""
    import anthropic
    from pydantic import ValidationError

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url, timeout=timeout)

    input_schema = DomainExtraction.model_json_schema()

    try:
        response = client.messages.create(
            model=model,
            max_tokens=_ANTHROPIC_MAX_TOKENS,
            system=_DOMAIN_EXTRACT_PROMPT,
            messages=[
                {"role": "user", "content": f"Extract domains from:\n\n{text}"},
            ],
            tools=[
                {
                    "name": "submit_domains",
                    "description": "Submit the extracted domain proposals.",
                    "input_schema": input_schema,
                }
            ],
            tool_choice={"type": "tool", "name": "submit_domains"},
        )
    except (anthropic.APIConnectionError, anthropic.APIStatusError, anthropic.APIError) as exc:
        raise LLMRequestError(f"Anthropic request failed: {exc}") from exc

    tool_use = next(
        (block for block in response.content if getattr(block, "type", None) == "tool_use"),
        None,
    )
    if tool_use is None:
        raise LLMRequestError(
            "Anthropic response contains no tool_use block "
            f"(stop_reason={response.stop_reason!r})."
        )

    raw: Any = tool_use.input
    if not isinstance(raw, dict):
        raise LLMRequestError(
            f"Anthropic tool_use 'input' is not an object (got {type(raw).__name__})."
        )

    try:
        extraction = DomainExtraction.model_validate(raw)
    except ValidationError as exc:
        raise LLMRequestError(
            f"Anthropic structured output failed domain extraction validation: {exc}"
        ) from exc
    return extraction.model_dump(mode="json")


def extract_domains(text: str) -> dict:
    """Extract proposed domains from free text using the configured LLM provider.

    Returns a dict shaped like ``{"domains": [{"name": ..., "description": ...,
    "priority": ...}, ...]}``.  These are PROPOSALS only — the caller does NOT
    save them to the database.

    Args:
        text: Free-form text (meeting notes, planning docs, etc.) to analyse.

    Returns:
        A dict conforming to ``DomainExtraction``: ``{"domains": [DomainProposal]}``.

    Raises:
        LLMNotConfiguredError: A required config var (provider/key/model) is
                               unset or blank. Routes maps this to HTTP 503.
        LLMRequestError:       The call is configured but failed (transport, API
                               error, or unparseable/invalid response).
                               Routes maps this to HTTP 502.
    """
    provider, api_key, model, base_url, timeout = _load_config()

    if provider == "openai":
        return _extract_openai(text, api_key, model, base_url, timeout)
    else:  # provider == "anthropic"  (validated in _load_config)
        return _extract_anthropic(text, api_key, model, base_url, timeout)


def draft_report(notes: str, context: dict) -> dict:
    """Draft a structured weekly report from raw meeting notes.

    Sends *notes* and *context* to the configured provider and returns a dict
    shaped like ``models.ReportDocument``. Structured output is enforced by the
    Pydantic model: OpenAI via native strict parsing, Anthropic via forced tool
    use. There is no fallback mode; a failed or non-conforming response raises
    ``LLMRequestError``.

    Args:
        notes:   Raw meeting notes, pasted verbatim by the user.
        context: Champion state hints built by ``reports.build_draft_context``
                 (current domains, tasks, artifacts) to help the model rephrase,
                 de-duplicate, and map notes onto existing entities.

    Returns:
        A dict conforming to ``models.ReportDocument``. The caller
        (``routes/reports.py``) re-validates it against ``ReportDocument``.

    Raises:
        LLMNotConfiguredError: A required config var (provider/key/model) is
                               unset or blank. Routes maps this to HTTP 503.
        LLMRequestError:       The call is configured but failed (transport, API
                               error, or unparseable/invalid response).
                               Routes maps this to HTTP 502.
    """
    provider, api_key, model, base_url, timeout = _load_config()

    if provider == "openai":
        return _draft_openai(notes, context, api_key, model, base_url, timeout)
    else:  # provider == "anthropic"  (validated in _load_config)
        return _draft_anthropic(notes, context, api_key, model, base_url, timeout)
