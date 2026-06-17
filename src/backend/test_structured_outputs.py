"""Inline tests for the structured-output LLM adapter (Wave 2 Agent 2A).

Run from src/backend/:
    python3 test_structured_outputs.py

All network calls are monkeypatched — no real server is contacted.
Each test asserts:
  - The correct request body was sent (schema in response_format / tools).
  - The parsed return value is a valid ReportDocument.
"""

from __future__ import annotations

import io
import json
import os
import sys
import unittest
import urllib.error
import urllib.request
from http.client import HTTPResponse
from io import BytesIO
from unittest.mock import MagicMock, patch

# Ensure we can import from the backend package root
sys.path.insert(0, os.path.dirname(__file__))

import llm.interface as iface
from models import ReportDocument

# ---------------------------------------------------------------------------
# Shared fixture — a minimal valid report dict matching ReportDocument
# ---------------------------------------------------------------------------
_VALID_REPORT = {
    "champion": "Alice",
    "meeting_date": "2024-01-15",
    "raw_notes": "Alice discussed progress on the NLP domain.",
    "participants": ["Alice", "Bob"],
    "domains": [
        {
            "domain": "NLP",
            "tasks": [{"task": "Entity extraction", "status": "in-progress"}],
            "artifacts": [],
        }
    ],
    "action_items": [{"text": "Review NLP pipeline by Friday"}],
    "discussion": None,
    "issues": None,
}

# Set required env vars for all tests
_ENV = {
    "TRACKER_LLM_PROVIDER": "openai",
    "TRACKER_LLM_ENDPOINT": "http://llm-host.internal:8080/v1",
    "TRACKER_LLM_API_KEY": "test-key",
    "TRACKER_LLM_MODEL": "test-model",
    "TRACKER_LLM_STRUCTURED": "auto",
}


# ---------------------------------------------------------------------------
# HTTP mock helpers
# ---------------------------------------------------------------------------

class _FakeHTTPResponse:
    """Mimics the object returned by urllib.request.urlopen."""

    def __init__(self, body: bytes, status: int = 200):
        self._body = body
        self.status = status

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def _openai_response(report: dict) -> bytes:
    """Wrap report dict in an OpenAI chat completions response envelope."""
    content = json.dumps({"report": report})
    return json.dumps({
        "choices": [{"message": {"content": content}}]
    }).encode("utf-8")


def _openai_tool_response(report: dict) -> bytes:
    """Wrap report dict in an Anthropic tool_use response envelope."""
    return json.dumps({
        "content": [
            {
                "type": "tool_use",
                "name": "emit_report",
                "input": report,
            }
        ]
    }).encode("utf-8")


def _anthropic_prefill_response(report: dict) -> bytes:
    """Wrap report in an Anthropic text-continuation response (prefill echo)."""
    # Simulate a server that echoes the `{` prefill by returning the full JSON.
    content = json.dumps({"report": report})
    return json.dumps({
        "content": [{"type": "text", "text": content}]
    }).encode("utf-8")


def _make_http_error(code: int, body: str) -> urllib.error.HTTPError:
    """Create a urllib HTTPError with a readable body."""
    body_bytes = body.encode("utf-8")
    fp = BytesIO(body_bytes)
    err = urllib.error.HTTPError(
        url="http://test",
        code=code,
        msg=f"HTTP {code}",
        hdrs=None,
        fp=fp,
    )
    return err


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOpenAIJsonSchemaStructuredOutput(unittest.TestCase):
    """OpenAI dialect: assert json_schema request is built and parsed."""

    def test_json_schema_request_body_and_parse(self):
        """draft_report sends response_format.json_schema and returns valid report."""
        captured_body = {}

        def mock_urlopen(req, timeout=None):
            # Capture the request body for assertion
            raw = req.data
            captured_body["payload"] = json.loads(raw)
            return _FakeHTTPResponse(_openai_response(_VALID_REPORT))

        env = {**_ENV, "TRACKER_LLM_PROVIDER": "openai", "TRACKER_LLM_STRUCTURED": "auto"}

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            result = iface.draft_report("Alice discussed NLP.", {"champion": "Alice"})

        # Assert the request used json_schema response_format
        rf = captured_body["payload"]["response_format"]
        self.assertEqual(rf["type"], "json_schema", "response_format.type must be json_schema")
        self.assertIn("json_schema", rf, "json_schema key must be present")
        js = rf["json_schema"]
        self.assertEqual(js["name"], "report")
        self.assertTrue(js.get("strict"), "strict must be True")
        schema = js["schema"]
        self.assertIn("properties", schema, "schema must have properties")
        self.assertIn("$defs", schema, "schema must have $defs")

        # Assert strict compliance: all properties in required at top level
        top_props = set(schema["properties"].keys())
        top_required = set(schema.get("required", []))
        self.assertEqual(
            top_props, top_required,
            f"strict mode: all top-level properties must be in required. "
            f"missing: {top_props - top_required}"
        )

        # Assert no oneOf in $defs (oneOf unsupported by strict mode)
        for def_name, def_schema in schema.get("$defs", {}).items():
            self.assertNotIn(
                "oneOf", def_schema,
                f"strict mode: $defs/{def_name} must not contain oneOf"
            )

        # Assert result is a valid ReportDocument
        doc = ReportDocument.model_validate(result)
        self.assertEqual(doc.champion, "Alice")
        self.assertEqual(doc.meeting_date, "2024-01-15")

    def test_json_schema_request_contains_schema_content(self):
        """The schema sent in response_format.json_schema contains key definitions."""
        captured_body = {}

        def mock_urlopen(req, timeout=None):
            captured_body["payload"] = json.loads(req.data)
            return _FakeHTTPResponse(_openai_response(_VALID_REPORT))

        env = {**_ENV, "TRACKER_LLM_PROVIDER": "openai", "TRACKER_LLM_STRUCTURED": "json_schema"}

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            iface.draft_report("notes", {})

        schema = captured_body["payload"]["response_format"]["json_schema"]["schema"]
        # Schema must contain our domain-specific definitions
        defs = schema.get("$defs", {})
        self.assertIn("domainSection", defs)
        self.assertIn("taskEntry", defs)
        self.assertIn("artifactEntry", defs)
        self.assertIn("actionItem", defs)
        # taskEntry must not have oneOf
        self.assertNotIn("oneOf", defs["taskEntry"])
        # taskEntry must have additionalProperties: false
        self.assertFalse(defs["taskEntry"].get("additionalProperties", True))


class TestAnthropicForcedToolUse(unittest.TestCase):
    """Anthropic dialect: assert forced tool-use request is built and parsed."""

    def test_tool_use_request_body_and_parse(self):
        """draft_report sends tools + tool_choice and reads from tool_use.input."""
        captured_body = {}

        def mock_urlopen(req, timeout=None):
            captured_body["payload"] = json.loads(req.data)
            return _FakeHTTPResponse(_openai_tool_response(_VALID_REPORT))

        env = {
            **_ENV,
            "TRACKER_LLM_PROVIDER": "anthropic",
            "TRACKER_LLM_STRUCTURED": "auto",
        }

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            result = iface.draft_report("Alice discussed NLP.", {"champion": "Alice"})

        payload = captured_body["payload"]

        # Assert tools array is present
        self.assertIn("tools", payload, "Anthropic tool-use: tools must be in body")
        tools = payload["tools"]
        self.assertEqual(len(tools), 1, "Exactly one tool must be defined")
        tool = tools[0]
        self.assertEqual(tool["name"], "emit_report")
        self.assertIn("input_schema", tool, "tool must have input_schema")
        # input_schema must be our report schema
        input_schema = tool["input_schema"]
        self.assertIn("properties", input_schema)
        self.assertIn("champion", input_schema["properties"])

        # Assert tool_choice is present and forces emit_report
        self.assertIn("tool_choice", payload, "tool_choice must be in body")
        tc = payload["tool_choice"]
        self.assertEqual(tc["type"], "tool")
        self.assertEqual(tc["name"], "emit_report")

        # Assert no assistant prefill message (tool-use path doesn't use it)
        messages = payload.get("messages", [])
        assistant_msgs = [m for m in messages if m.get("role") == "assistant"]
        self.assertEqual(
            len(assistant_msgs), 0,
            "Tool-use path must NOT send an assistant prefill message"
        )

        # Assert result is a valid ReportDocument read from tool_use.input
        doc = ReportDocument.model_validate(result)
        self.assertEqual(doc.champion, "Alice")

    def test_tool_use_strategy_off_uses_prefill(self):
        """strategy=off bypasses tool-use and uses the prefill path."""
        captured_body = {}

        def mock_urlopen(req, timeout=None):
            captured_body["payload"] = json.loads(req.data)
            return _FakeHTTPResponse(_anthropic_prefill_response(_VALID_REPORT))

        env = {
            **_ENV,
            "TRACKER_LLM_PROVIDER": "anthropic",
            "TRACKER_LLM_STRUCTURED": "off",
        }

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            result = iface.draft_report("notes", {})

        payload = captured_body["payload"]
        # No tools in body
        self.assertNotIn("tools", payload, "strategy=off must not send tools")
        self.assertNotIn("tool_choice", payload, "strategy=off must not send tool_choice")
        # Should have assistant prefill
        messages = payload.get("messages", [])
        assistant_msgs = [m for m in messages if m.get("role") == "assistant"]
        self.assertEqual(len(assistant_msgs), 1, "Prefill path must send one assistant message")
        self.assertEqual(assistant_msgs[0]["content"], "{")

        doc = ReportDocument.model_validate(result)
        self.assertEqual(doc.champion, "Alice")


class TestFallbackLadder(unittest.TestCase):
    """Fallback: HTTP 400 unsupported response_format → adapter falls back and succeeds."""

    def test_openai_json_schema_rejected_falls_back_to_json_object(self):
        """When server rejects json_schema with 400, adapter retries with json_object."""
        call_count = [0]
        request_bodies = []

        def mock_urlopen(req, timeout=None):
            call_count[0] += 1
            body = json.loads(req.data)
            request_bodies.append(body)

            if call_count[0] == 1:
                # First call (json_schema attempt) → reject
                raise _make_http_error(
                    400,
                    '{"error": {"message": "unsupported response_format type json_schema"}}'
                )
            # Second call (json_object fallback) → succeed
            return _FakeHTTPResponse(_openai_response(_VALID_REPORT))

        env = {**_ENV, "TRACKER_LLM_PROVIDER": "openai", "TRACKER_LLM_STRUCTURED": "auto"}

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            result = iface.draft_report("notes", {})

        # Two calls must have been made
        self.assertEqual(call_count[0], 2, "Adapter must retry after 400 rejection")

        # First call must have been json_schema
        first_rf = request_bodies[0]["response_format"]
        self.assertEqual(first_rf["type"], "json_schema")

        # Second call must have fallen back to json_object
        second_rf = request_bodies[1]["response_format"]
        self.assertEqual(second_rf["type"], "json_object")

        # Result must still be valid
        doc = ReportDocument.model_validate(result)
        self.assertEqual(doc.champion, "Alice")

    def test_anthropic_tool_rejected_falls_back_to_prefill(self):
        """When server rejects tools with 400, adapter falls back to prefill path."""
        call_count = [0]
        request_bodies = []

        def mock_urlopen(req, timeout=None):
            call_count[0] += 1
            body = json.loads(req.data)
            request_bodies.append(body)

            if call_count[0] == 1:
                # First call (tool-use) → reject
                raise _make_http_error(
                    400,
                    '{"error": {"type": "invalid_request_error", '
                    '"message": "tools is not supported"}}'
                )
            # Second call (prefill fallback) → succeed
            return _FakeHTTPResponse(_anthropic_prefill_response(_VALID_REPORT))

        env = {
            **_ENV,
            "TRACKER_LLM_PROVIDER": "anthropic",
            "TRACKER_LLM_STRUCTURED": "auto",
        }

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            result = iface.draft_report("notes", {})

        self.assertEqual(call_count[0], 2, "Adapter must retry after 400 rejection")

        # First call must have tools + tool_choice
        self.assertIn("tools", request_bodies[0])
        self.assertIn("tool_choice", request_bodies[0])

        # Second call (fallback) must use prefill and NOT have tools
        self.assertNotIn("tools", request_bodies[1])
        messages = request_bodies[1].get("messages", [])
        assistant_msgs = [m for m in messages if m.get("role") == "assistant"]
        self.assertEqual(len(assistant_msgs), 1)
        self.assertEqual(assistant_msgs[0]["content"], "{")

        doc = ReportDocument.model_validate(result)
        self.assertEqual(doc.champion, "Alice")

    def test_non_unsupported_4xx_raises_llm_request_error(self):
        """HTTP 403 (auth error, not 'unsupported param') must NOT trigger fallback."""
        def mock_urlopen(req, timeout=None):
            raise _make_http_error(403, '{"error": "Forbidden"}')

        env = {**_ENV, "TRACKER_LLM_PROVIDER": "openai", "TRACKER_LLM_STRUCTURED": "auto"}

        with patch.dict(os.environ, env, clear=False), \
             patch("urllib.request.urlopen", side_effect=mock_urlopen):
            with self.assertRaises(iface.LLMRequestError):
                iface.draft_report("notes", {})


class TestStrictSchemaDerivation(unittest.TestCase):
    """Unit tests for _derive_strict_schema."""

    def setUp(self):
        self.raw = iface._load_schema()
        self.strict = iface._derive_strict_schema(self.raw)

    def test_no_oneOf_in_any_def(self):
        """oneOf must be absent from all $defs after transformation."""
        for name, defn in self.strict.get("$defs", {}).items():
            self.assertNotIn(
                "oneOf", defn,
                f"$defs/{name} still contains oneOf after strict transformation"
            )

    def test_all_object_properties_in_required(self):
        """Every object node must have all its property keys in required."""
        def check_node(node, path):
            if not isinstance(node, dict):
                return
            if node.get("type") == "object" or "properties" in node:
                props = set(node.get("properties", {}).keys())
                required = set(node.get("required", []))
                self.assertEqual(
                    props, required,
                    f"At {path}: properties {props - required} not in required"
                )
            # Recurse
            for key, val in node.items():
                if key in ("$defs", "properties"):
                    for sub_key, sub_val in val.items():
                        check_node(sub_val, f"{path}/{key}/{sub_key}")
                elif key in ("items", "anyOf"):
                    if isinstance(val, list):
                        for i, item in enumerate(val):
                            check_node(item, f"{path}/{key}[{i}]")
                    else:
                        check_node(val, f"{path}/{key}")

        check_node(self.strict, "#")

    def test_no_unsupported_keywords(self):
        """$schema, $id, format, default must be stripped from all nodes."""
        def check_node(node, path):
            if not isinstance(node, dict):
                return
            for kw in ("$schema", "$id", "format", "default"):
                self.assertNotIn(
                    kw, node,
                    f"Unsupported keyword '{kw}' found at {path}"
                )
            for key, val in node.items():
                if isinstance(val, dict):
                    check_node(val, f"{path}/{key}")
                elif isinstance(val, list):
                    for i, item in enumerate(val):
                        if isinstance(item, dict):
                            check_node(item, f"{path}/{key}[{i}]")

        check_node(self.strict, "#")

    def test_additionalProperties_false_on_all_objects(self):
        """All object nodes must have additionalProperties: false."""
        def check_node(node, path):
            if not isinstance(node, dict):
                return
            if node.get("type") == "object" or "properties" in node:
                self.assertFalse(
                    node.get("additionalProperties", True),
                    f"At {path}: additionalProperties must be false"
                )
            for key, val in node.items():
                if key in ("$defs", "properties"):
                    for sub_key, sub_val in val.items():
                        check_node(sub_val, f"{path}/{key}/{sub_key}")
                elif key in ("items", "anyOf"):
                    if isinstance(val, list):
                        for i, item in enumerate(val):
                            check_node(item, f"{path}/{key}[{i}]")
                    else:
                        check_node(val, f"{path}/{key}")

        check_node(self.strict, "#")

    def test_defs_and_ref_preserved(self):
        """$defs and $ref references must be preserved."""
        self.assertIn("$defs", self.strict)
        # domains items should have a $ref to domainSection
        domains_items = self.strict["properties"]["domains"]["items"]
        # Items may have $ref directly or after transformation
        has_ref = "$ref" in domains_items or "anyOf" in domains_items
        self.assertTrue(has_ref, "domains items should preserve $ref or anyOf")

    def test_source_schema_unmodified(self):
        """_derive_strict_schema must not mutate the input schema."""
        original = iface._load_schema()
        # The raw schema should still have oneOf in taskEntry
        self.assertIn("oneOf", original["$defs"]["taskEntry"])
        # And optional fields NOT in top-level required
        top_required = set(original.get("required", []))
        self.assertNotIn("participants", top_required)


class TestImports(unittest.TestCase):
    """Smoke-test that the module and app import cleanly."""

    def test_interface_imports(self):
        import llm.interface  # noqa: F401

    def test_app_imports(self):
        import app  # noqa: F401


if __name__ == "__main__":
    unittest.main(verbosity=2)
