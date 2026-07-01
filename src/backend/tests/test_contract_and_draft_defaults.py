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
import sqlite3
import sys
import tempfile

import pytest

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

_SCHEMA = _BACKEND / "schema.sql"


def _fresh_conn() -> sqlite3.Connection:
    """A THROWAWAY in-memory DB built from schema.sql (never touches tracker.db)."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(_SCHEMA.read_text(encoding="utf-8"))
    conn.commit()
    return conn


@pytest.fixture()
def conn():
    c = _fresh_conn()
    try:
        yield c
    finally:
        c.close()


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
#
# apply_draft_defaults now reads the DB (the task-owner journal signal) so the
# preview mirrors save EXACTLY. Every scenario is built on a THROWAWAY DB from
# schema.sql via the ``conn`` fixture (never touches tracker.db). We seed:
#   * task "Matched task"      — an ESTABLISHED-owner journal (a report row naming
#                                Tomer) → current-state owner "Tomer".
#   * task "Ownerless matched" — a NEVER-OWNED journal (a single report row with
#                                NULL owner, no owner decision ever) → _task_
#                                journal_has_owner is False, current-state None.
#   * artifact "gRPC scaffold generator" — lives in a domain (dom_b).


def _seed(conn: sqlite3.Connection) -> dict:
    """Seed one team (champion Maya) + the fixtures above; return ids + a draft
    context whose owner/domain values match the seeded current-state."""
    team_id = conn.execute(
        "INSERT INTO team (name, champion_name) VALUES ('Radar', 'Maya')"
    ).lastrowid
    dom_a = conn.execute(
        "INSERT INTO domain (team_id, name) VALUES (?, 'Infrastructure')", (team_id,)
    ).lastrowid
    dom_b = conn.execute(
        "INSERT INTO domain (team_id, name) VALUES (?, 'Signals')", (team_id,)
    ).lastrowid

    owned = conn.execute(
        "INSERT INTO task (domain_id, name, status, owner) "
        "VALUES (?, 'Matched task', 'in-progress', 'Tomer')",
        (dom_a,),
    ).lastrowid
    conn.execute(
        "INSERT INTO task_history "
        "(task_id, report_id, meeting_date, status_at_meeting, owner, source) "
        "VALUES (?, NULL, '2026-05-01', 'in-progress', 'Tomer', 'report')",
        (owned,),
    )

    ownerless = conn.execute(
        "INSERT INTO task (domain_id, name, status, owner) "
        "VALUES (?, 'Ownerless matched', 'planned', NULL)",
        (dom_a,),
    ).lastrowid
    conn.execute(
        "INSERT INTO task_history "
        "(task_id, report_id, meeting_date, status_at_meeting, owner, source) "
        "VALUES (?, NULL, '2026-05-01', 'planned', NULL, 'report')",
        (ownerless,),
    )

    artifact = conn.execute(
        "INSERT INTO artifact (team_id, domain_id, name, type) "
        "VALUES (?, ?, 'gRPC scaffold generator', 'skill')",
        (team_id, dom_b),
    ).lastrowid
    conn.commit()

    context = {
        "champion_name": "Maya",
        "tasks": [
            {"id": owned, "name": "Matched task", "owner": "Tomer", "domain_id": dom_a},
            {"id": ownerless, "name": "Ownerless matched", "owner": None, "domain_id": dom_a},
        ],
        "artifacts": [
            {"id": artifact, "name": "gRPC scaffold generator", "domain_id": dom_b},
        ],
    }
    return {
        "team_id": team_id, "dom_a": dom_a, "dom_b": dom_b,
        "owned": owned, "ownerless": ownerless, "artifact": artifact,
        "context": context,
    }


def test_new_task_owner_defaults_to_champion(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-04", raw_notes="n",
        tasks=[ReportTaskEntry(task="Add idempotency keys", status=TaskStatus.in_progress)],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.tasks[0].owner == "Maya"


def test_named_task_owner_is_kept(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        tasks=[ReportTaskEntry(task="Pin Terraform", status=TaskStatus.planned, owner="Tomer")],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.tasks[0].owner == "Tomer"


def test_matched_task_inherits_established_owner(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-18", raw_notes="n",
        tasks=[ReportTaskEntry(id=s["owned"], task="Matched task", status=TaskStatus.abandoned)],
    )
    apply_draft_defaults(conn, doc, s["context"])
    # Matched task with no owner in the notes keeps Tomer, NOT the champion.
    assert doc.tasks[0].owner == "Tomer"


def test_matched_task_without_established_owner_falls_back_to_champion(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-18", raw_notes="n",
        tasks=[ReportTaskEntry(id=s["ownerless"], task="Ownerless matched",
                               status=TaskStatus.planned)],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.tasks[0].owner == "Maya"


def test_new_artifact_change_kind_defaults_to_added(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        artifacts=[ReportArtifactEntry(artifact="Secrets pre-commit hook", type=ArtifactType.hook)],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.added


def test_matched_artifact_same_domain_is_updated(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=s["artifact"], artifact="gRPC scaffold generator",
                                       domain_id=s["dom_b"])],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.updated


def test_matched_artifact_moved_domain_is_moved(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-11", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=s["artifact"], artifact="gRPC scaffold generator",
                                       domain_id=s["dom_a"])],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.moved


def test_explicit_change_kind_is_not_overwritten(conn):
    s = _seed(conn)
    doc = ReportDocument(
        champion="Maya", meeting_date="2026-05-18", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=s["artifact"], artifact="gRPC scaffold generator",
                                       change_kind=ArtifactChangeKind.retired,
                                       domain_id=s["dom_b"])],
    )
    apply_draft_defaults(conn, doc, s["context"])
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.retired


# ── (3) REGRESSION: preview must mirror SAVE — no divergence, no data loss ──────
#
# These two tests drive the FULL draft→save path on a throwaway DB and assert the
# preview (apply_draft_defaults) equals what fan_out_report actually persists.
# They FAIL against the pre-fix code (change_kind="moved" strips the domain;
# context-only owner default picks champion for a deliberately-cleared owner).


def test_matched_artifact_null_domain_keeps_domain_through_draft_and_save(conn):
    """FIX-NOW 1: a matched artifact the model left domain-less must stay IN PLACE.

    Draft default must NOT classify it "moved" (that would flip _update_artifact
    into re-placing the domain to NULL on save). Preview says "updated"; save
    then keeps the artifact's original domain and writes an "updated" history row.
    """
    from reports.engine import build_draft_context, fan_out_report

    team_id = conn.execute(
        "INSERT INTO team (name, champion_name) VALUES ('Radar', 'Dana')"
    ).lastrowid
    dom = conn.execute(
        "INSERT INTO domain (team_id, name) VALUES (?, 'gRPC')", (team_id,)
    ).lastrowid
    conn.commit()

    # First report CREATES the artifact in domain `dom`.
    fan_out_report(conn, team_id, ReportDocument(
        champion="Dana", meeting_date="2026-06-01", raw_notes="n",
        artifacts=[ReportArtifactEntry(artifact="gRPC skill", type=ArtifactType.skill,
                                       domain_id=dom, domain="gRPC")],
    ))
    art_id = conn.execute(
        "SELECT id FROM artifact WHERE name = 'gRPC skill'"
    ).fetchone()["id"]
    assert conn.execute(
        "SELECT domain_id FROM artifact WHERE id = ?", (art_id,)
    ).fetchone()["domain_id"] == dom

    # A follow-up draft MATCHES the artifact but leaves domain_id null (a plain
    # "we extended the gRPC skill" update).
    context = build_draft_context(conn, team_id)
    doc = ReportDocument(
        champion="Dana", meeting_date="2026-06-08", raw_notes="n",
        artifacts=[ReportArtifactEntry(id=art_id, artifact="gRPC skill",
                                       note="extended to support streaming RPCs")],
    )
    apply_draft_defaults(conn, doc, context)

    # PREVIEW: classified as a plain update, NOT a move.
    assert doc.artifacts[0].change_kind == ArtifactChangeKind.updated

    # SAVE the previewed doc and confirm the ROW mirrors the preview: domain
    # preserved (still `dom`, not NULL) and the history label is "updated".
    fan_out_report(conn, team_id, doc)
    row = conn.execute("SELECT domain_id FROM artifact WHERE id = ?", (art_id,)).fetchone()
    assert row["domain_id"] == dom, f"domain silently stripped -> {row['domain_id']}"
    latest_kind = conn.execute(
        "SELECT change_kind FROM artifact_history WHERE artifact_id = ? "
        "ORDER BY id DESC LIMIT 1", (art_id,),
    ).fetchone()["change_kind"]
    assert latest_kind == "updated", f"got {latest_kind}"


def test_matched_task_cleared_owner_stays_blank_but_never_owned_gets_champion(conn):
    """FIX-NOW 2: distinguish a DELIBERATELY-CLEARED owner from a NEVER-OWNED one.

    Both show owner=None in the draft context; the journal (via
    _task_journal_has_owner) is the tiebreak that SAVE uses. The preview must
    match: cleared → blank (the manual NULL clear is authoritative); never-owned
    → champion.
    """
    from reports.engine import (
        apply_manual_task_edit, build_draft_context, fan_out_report,
    )

    team_id = conn.execute(
        "INSERT INTO team (name, champion_name) VALUES ('Radar', 'Dana')"
    ).lastrowid
    dom = conn.execute(
        "INSERT INTO domain (team_id, name) VALUES (?, 'signal')", (team_id,)
    ).lastrowid
    conn.commit()

    # (a) A task that was owned (Mona) then had its owner DELIBERATELY CLEARED.
    fan_out_report(conn, team_id, ReportDocument(
        champion="Dana", meeting_date="2026-06-01", raw_notes="n",
        tasks=[ReportTaskEntry(task="Clutter map", status=TaskStatus.in_progress,
                               owner="Mona", domain_id=dom, domain="signal")],
    ))
    cleared_id = conn.execute(
        "SELECT t.id FROM task t JOIN domain d ON d.id = t.domain_id "
        "WHERE d.team_id = ? AND t.name = 'Clutter map'", (team_id,),
    ).fetchone()["id"]
    apply_manual_task_edit(conn, cleared_id, {"owner": None})
    assert conn.execute(
        "SELECT owner FROM task WHERE id = ?", (cleared_id,)
    ).fetchone()["owner"] is None

    # (b) A NEVER-OWNED task: a single report journal row with NULL owner (no
    # owner decision ever). Constructed directly — the normal create-path always
    # stamps an owner, so this edge is seeded explicitly.
    never_id = conn.execute(
        "INSERT INTO task (domain_id, name, status, owner) "
        "VALUES (?, 'Nightly recal', 'planned', NULL)", (dom,),
    ).lastrowid
    conn.execute(
        "INSERT INTO task_history "
        "(task_id, report_id, meeting_date, status_at_meeting, owner, source) "
        "VALUES (?, NULL, '2026-06-01', 'planned', NULL, 'report')", (never_id,),
    )
    conn.commit()

    context = build_draft_context(conn, team_id)
    doc = ReportDocument(
        champion="Dana", meeting_date="2026-06-08", raw_notes="n",
        tasks=[
            ReportTaskEntry(id=cleared_id, task="Clutter map", status=TaskStatus.in_progress),
            ReportTaskEntry(id=never_id, task="Nightly recal", status=TaskStatus.planned),
        ],
    )
    apply_draft_defaults(conn, doc, context)

    # PREVIEW: cleared stays blank, never-owned defaults to champion.
    by_id = {t.id: t.owner for t in doc.tasks}
    assert by_id[cleared_id] is None, f"cleared owner wrongly defaulted -> {by_id[cleared_id]!r}"
    assert by_id[never_id] == "Dana", f"never-owned should be champion -> {by_id[never_id]!r}"

    # SAVE the previewed doc and confirm the ROWS mirror the preview EXACTLY.
    fan_out_report(conn, team_id, doc)
    assert conn.execute(
        "SELECT owner FROM task WHERE id = ?", (cleared_id,)
    ).fetchone()["owner"] is None, "save must keep the deliberately-cleared owner blank"
    assert conn.execute(
        "SELECT owner FROM task WHERE id = ?", (never_id,)
    ).fetchone()["owner"] == "Dana", "save must give the never-owned task the champion"
