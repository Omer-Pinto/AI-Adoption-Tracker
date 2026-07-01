"""D-LLM contract proof: BOTH provider schema derivations + draft defaulting.

Part C evidence for the D-LLM work. Offline only — NO live LLM calls.

1. Schema derivation — the SAME two code paths ``llm/interface.py`` relies on:
   * OpenAI strict: ``openai.lib._pydantic.to_strict_json_schema`` (what
     ``chat.completions.parse(response_format=ReportDocument)`` runs internally).
   * Anthropic tool: ``ReportDocument.model_json_schema()`` (the ``input_schema``).
   Both must derive cleanly, and a representative ``ReportDocument`` must
   round-trip (dump → validate) under the contract.

2. Draft defaulting — ``apply_draft_defaults`` fills task owner (D8) and artifact
   change_kind (D3) exactly as the fan-out engine would on save, so the editor
   preview is never blank.

    python3 -m pytest tests/test_contract_and_draft_defaults.py -v
"""

from __future__ import annotations

import pathlib
import sys

# Ensure src/backend/ is importable.
_BACKEND = pathlib.Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from models import (  # noqa: E402
    ArtifactChangeKind,
    ArtifactType,
    ReportActionItem,
    ReportArtifactEntry,
    ReportDocument,
    ReportTaskEntry,
    TaskStatus,
)
from reports.engine import apply_draft_defaults  # noqa: E402


def _representative_doc() -> ReportDocument:
    """A doc exercising every sub-model + both id-null / id-set conventions."""
    return ReportDocument(
        champion="Maya",
        meeting_date="2026-05-11",
        participants=["Maya"],
        raw_notes="raw",
        tasks=[
            ReportTaskEntry(task="New task", status=TaskStatus.planned),
            ReportTaskEntry(
                id=7, task="Matched task", status=TaskStatus.in_progress,
                owner="Tomer", note="target date set to June 20th",
                due_date="2026-06-20", domain_id=3, domain="Infrastructure",
            ),
        ],
        artifacts=[
            ReportArtifactEntry(
                artifact="Secrets pre-commit hook", type=ArtifactType.hook,
                summary="Blocks secrets from being committed into config files",
                change_kind=ArtifactChangeKind.added,
            ),
            ReportArtifactEntry(
                id=4, artifact="gRPC scaffold generator", type=ArtifactType.skill,
                note="extended to support streaming RPCs",
                change_kind=ArtifactChangeKind.updated,
            ),
        ],
        action_items=[
            ReportActionItem(
                text="Evaluate whether the gRPC skill should be org-wide",
                status=TaskStatus.planned,
            ),
        ],
        discussion=["Company marketplace adoption is still low."],
        issues=["On-call fatigue creeping up from alert volume."],
    )


# ── (1) BOTH provider schema derivations pass from the SAME code paths ─────────

def test_openai_strict_schema_derivation():
    """OpenAI strict derivation (what chat.completions.parse runs) must succeed."""
    from openai.lib._pydantic import to_strict_json_schema

    schema = to_strict_json_schema(ReportDocument)
    assert schema["type"] == "object"
    # OpenAI strict: additionalProperties:false + every property in required.
    assert schema.get("additionalProperties") is False
    assert set(schema["required"]) == set(schema["properties"].keys())


def test_anthropic_input_schema_derivation():
    """Anthropic tool input_schema (model_json_schema) must derive cleanly."""
    schema = ReportDocument.model_json_schema()
    assert schema["type"] == "object"
    assert "ReportActionItem" in schema["$defs"]


def test_action_item_is_ai_lead_only_in_both_schemas():
    """A1+A2: the emitted action-item shape carries NO owner and NO domain."""
    from openai.lib._pydantic import to_strict_json_schema

    strict = to_strict_json_schema(ReportDocument)["$defs"]["ReportActionItem"]
    natural = ReportDocument.model_json_schema()["$defs"]["ReportActionItem"]
    for props in (strict["properties"], natural["properties"]):
        assert set(props) == {"text", "note", "status", "due_date"}
        assert "owner" not in props
        assert "domain" not in props and "domain_id" not in props


def test_representative_doc_round_trips():
    """A representative ReportDocument dumps and re-validates losslessly."""
    doc = _representative_doc()
    dumped = doc.model_dump(mode="json")
    again = ReportDocument.model_validate(dumped)
    assert again.model_dump(mode="json") == dumped


# ── (2) draft defaulting mirrors the save engine (D8 owner, D3 change_kind) ─────

_CONTEXT = {
    "champion_name": "Maya",
    "tasks": [
        {"id": 7, "name": "Matched task", "owner": "Tomer", "domain_id": 3},
        {"id": 8, "name": "Ownerless matched", "owner": None, "domain_id": 3},
    ],
    "artifacts": [
        {"id": 4, "name": "gRPC scaffold generator", "domain_id": 2},
    ],
}


def test_new_task_owner_defaults_to_champion():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-04", raw_notes="n",
        tasks=[ReportTaskEntry(task="Add idempotency keys", status=TaskStatus.in_progress)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.tasks[0].owner == "Maya"


def test_named_task_owner_is_kept():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        tasks=[ReportTaskEntry(task="Pin Terraform", status=TaskStatus.planned, owner="Tomer")],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.tasks[0].owner == "Tomer"


def test_matched_task_inherits_established_owner():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-18", raw_notes="n",
        tasks=[ReportTaskEntry(id=7, task="Matched task", status=TaskStatus.abandoned)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    # Matched task with no owner in the notes keeps Tomer, NOT the champion.
    assert doc.tasks[0].owner == "Tomer"


def test_matched_task_without_established_owner_falls_back_to_champion():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-18", raw_notes="n",
        tasks=[ReportTaskEntry(id=8, task="Ownerless matched", status=TaskStatus.planned)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.tasks[0].owner == "Maya"


def test_new_artifact_change_kind_defaults_to_added():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        artifacts=[ReportArtifactEntry(artifact="Secrets pre-commit hook", type=ArtifactType.hook)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.added


def test_matched_artifact_same_domain_is_updated():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=4, artifact="gRPC scaffold generator", domain_id=2)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.updated


def test_matched_artifact_moved_domain_is_moved():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=4, artifact="gRPC scaffold generator", domain_id=99)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.moved


def test_explicit_change_kind_is_not_overwritten():
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-18", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=4, artifact="gRPC scaffold generator",
                                       change_kind=ArtifactChangeKind.retired, domain_id=2)],
    )
    apply_draft_defaults(doc, _CONTEXT)
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.retired
