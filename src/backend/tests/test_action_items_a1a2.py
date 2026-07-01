"""A1+A2 contract proof: action items are the AI Lead's own to-dos (no owner),
full in-place CRUD on EVERY item, create-once (never re-folded on report edit),
and only the latest report is editable.

Runs against a THROWAWAY DB built from schema.sql in pytest's ``tmp_path`` (never
touches the user's tracker.db). Route-level cases drive the real FastAPI app via
``TestClient`` with ``db.DB_PATH`` monkeypatched to the temp file; engine-level
cases drive the real engine functions directly.

    python3 -m pytest tests/test_action_items_a1a2.py -v
"""

from __future__ import annotations

import datetime
import pathlib
import sqlite3
import sys

import pytest
from fastapi.testclient import TestClient

# Ensure src/backend/ is importable.
_BACKEND = pathlib.Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import db  # noqa: E402
from models import (  # noqa: E402
    ReportActionItem,
    ReportDocument,
    ReportTaskEntry,
    TaskStatus,
)
from reports.engine import fan_out_report, replay_report_edit  # noqa: E402

SCHEMA = _BACKEND / "schema.sql"
TOMORROW = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def seeded(tmp_path, monkeypatch):
    """Point db.DB_PATH at a throwaway file, apply schema, seed one team+domain.

    Yields ``(team_id, domain_id)``. The temp file is auto-removed with tmp_path.
    """
    dbfile = tmp_path / "a1a2.db"
    monkeypatch.setattr(db, "DB_PATH", dbfile)

    conn = sqlite3.connect(dbfile)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    team_id = conn.execute(
        "INSERT INTO team (name, champion_name) VALUES ('Radar', 'Dana')"
    ).lastrowid
    domain_id = conn.execute(
        "INSERT INTO domain (team_id, name) VALUES (?, 'signal')", (team_id,)
    ).lastrowid
    conn.commit()
    conn.close()
    return team_id, domain_id


@pytest.fixture()
def client(seeded):
    """A TestClient over the real app, wired to the seeded throwaway DB."""
    from app import app

    with TestClient(app) as c:
        yield c


def _make_report(team_id, domain_id, meeting_date, action_texts):
    """Fan out one report carrying the given action-item texts; return report_id."""
    conn = db.get_connection()
    try:
        row = fan_out_report(
            conn,
            team_id,
            ReportDocument(
                champion="Dana",
                meeting_date=meeting_date,
                raw_notes="n",
                action_items=[
                    ReportActionItem(text=t, domain_id=domain_id, domain="signal")
                    for t in action_texts
                ],
            ),
        )
        return row["id"]
    finally:
        conn.close()


def _action_item_rows():
    conn = db.get_connection()
    try:
        return conn.execute(
            "SELECT id, report_id, text, note, status FROM action_item ORDER BY id"
        ).fetchall()
    finally:
        conn.close()


# ── (a) PATCH text on a report-derived item SUCCEEDS ────────────────────────────

def test_patch_text_on_report_derived_item_succeeds(client, seeded):
    team_id, domain_id = seeded
    _make_report(team_id, domain_id, "2026-06-08", ["AI Lead to write a skill"])
    item_id = _action_item_rows()[0]["id"]

    resp = client.patch(
        f"/api/action-items/{item_id}", json={"text": "AI Lead to write TWO skills"}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "AI Lead to write TWO skills"
    assert _action_item_rows()[0]["text"] == "AI Lead to write TWO skills"


def test_patch_note_and_domain_on_report_derived_item(client, seeded):
    team_id, domain_id = seeded
    _make_report(team_id, domain_id, "2026-06-08", ["AI Lead follow-up"])
    item_id = _action_item_rows()[0]["id"]

    resp = client.patch(
        f"/api/action-items/{item_id}",
        json={"note": "context added", "domain_id": None, "status": "in-progress"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["note"] == "context added"
    assert body["domain_id"] is None
    assert body["status"] == "in-progress"


# ── (b) DELETE a report-derived item SUCCEEDS ──────────────────────────────────

def test_delete_report_derived_item_succeeds(client, seeded):
    team_id, domain_id = seeded
    _make_report(team_id, domain_id, "2026-06-08", ["AI Lead to-do"])
    item_id = _action_item_rows()[0]["id"]

    resp = client.delete(f"/api/action-items/{item_id}")
    assert resp.status_code == 204, resp.text
    assert _action_item_rows() == []


def test_delete_missing_item_404(client):
    assert client.delete("/api/action-items/9999").status_code == 404


# ── standalone create: no owner, optional note + domain ─────────────────────────

def test_create_standalone_item_with_note_and_domain(client, seeded):
    _team_id, domain_id = seeded
    resp = client.post(
        "/api/action-items",
        json={"text": "AI Lead standalone", "note": "n1", "domain_id": domain_id},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["note"] == "n1"
    assert body["domain"] == "signal"
    assert body["report_id"] is None
    # No owner concept exists in the response contract.
    assert "owner" not in body


def test_create_blank_text_rejected_422(client):
    assert client.post("/api/action-items", json={"text": "   "}).status_code == 422


# ── worklist returns EVERY item (report-derived AND standalone), with note ──────

def test_worklist_returns_all_items_no_owner_filter(client, seeded):
    team_id, domain_id = seeded
    _make_report(team_id, domain_id, "2026-06-08", ["from report"])
    client.post("/api/action-items", json={"text": "standalone", "note": "hi"})

    resp = client.get("/api/ai-lead/action-items")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    texts = {i["text"] for i in items}
    # Both the report-derived item (which historically would NOT have owner='AI
    # Lead') and the standalone item are returned.
    assert texts == {"from report", "standalone"}
    standalone = next(i for i in items if i["text"] == "standalone")
    assert standalone["note"] == "hi"
    assert standalone["report_id"] is None
    report_derived = next(i for i in items if i["text"] == "from report")
    assert report_derived["team_name"] == "Radar"
    assert report_derived["champion_name"] == "Dana"


# ── (c) editing a NON-LATEST report → 409; the latest one → editable ───────────

def _min_doc(meeting_date):
    return {
        "champion": "Dana",
        "meeting_date": meeting_date,
        "raw_notes": "n",
        "participants": [],
        "tasks": [],
        "artifacts": [],
        "action_items": [],
        "discussion": [],
        "issues": [],
    }


def test_edit_non_latest_report_409(client, seeded):
    team_id, domain_id = seeded
    older = _make_report(team_id, domain_id, "2026-06-01", ["a"])
    newer = _make_report(team_id, domain_id, "2026-06-15", ["b"])

    # Editing the OLDER (non-latest) report is rejected with 409.
    resp_old = client.patch(f"/api/reports/{older}", json=_min_doc("2026-06-01"))
    assert resp_old.status_code == 409, resp_old.text
    assert "latest" in resp_old.json()["detail"].lower()

    # Editing the LATEST report is allowed.
    resp_new = client.patch(f"/api/reports/{newer}", json=_min_doc("2026-06-15"))
    assert resp_new.status_code == 200, resp_new.text


def test_edit_missing_report_404(client):
    assert client.patch("/api/reports/9999", json=_min_doc("2026-06-01")).status_code == 404


# ── (d) replay/edit of the LATEST report does NOT delete/recreate action items ──

def test_replay_does_not_touch_action_items_create_once(seeded):
    """Engine-level: replay_report_edit must leave the report's action items alone.

    Create-once (A1+A2): the item keeps its id, is not deleted when the edited doc
    drops it, and is not duplicated when the edited doc re-includes it.
    """
    team_id, domain_id = seeded
    conn = db.get_connection()
    try:
        row = fan_out_report(
            conn,
            team_id,
            ReportDocument(
                champion="Dana",
                meeting_date="2026-06-15",
                raw_notes="n",
                tasks=[
                    ReportTaskEntry(task="T1", status=TaskStatus.planned,
                                    domain_id=domain_id, domain="signal")
                ],
                action_items=[
                    ReportActionItem(text="AI Lead to-do", domain_id=domain_id,
                                     domain="signal")
                ],
            ),
        )
        report_id = row["id"]
        before = conn.execute(
            "SELECT id, text FROM action_item WHERE report_id = ?", (report_id,)
        ).fetchall()
        assert len(before) == 1
        original_id = before[0]["id"]

        # A user later edits the action item's text directly (in-place CRUD).
        conn.execute(
            "UPDATE action_item SET text = 'edited by user' WHERE id = ?",
            (original_id,),
        )
        conn.commit()

        # Edit the (latest) report, DROPPING the action item from the doc and
        # changing a task. Replay must NOT delete or re-fold the action item.
        replay_report_edit(
            conn,
            report_id,
            ReportDocument(
                champion="Dana",
                meeting_date="2026-06-15",
                raw_notes="n",
                tasks=[
                    ReportTaskEntry(task="T1", status=TaskStatus.blocked,
                                    domain_id=domain_id, domain="signal")
                ],
                action_items=[],  # doc no longer lists it
            ),
        )

        after = conn.execute(
            "SELECT id, text FROM action_item WHERE report_id = ?", (report_id,)
        ).fetchall()
        assert len(after) == 1, "action item must survive the edit (create-once)"
        assert after[0]["id"] == original_id, "same row id (not deleted/recreated)"
        assert after[0]["text"] == "edited by user", "user's in-place edit preserved"
    finally:
        conn.close()


def test_replay_does_not_duplicate_action_items(seeded):
    """Re-including the same action item in an edited doc must NOT duplicate it."""
    team_id, domain_id = seeded
    conn = db.get_connection()
    try:
        row = fan_out_report(
            conn,
            team_id,
            ReportDocument(
                champion="Dana",
                meeting_date="2026-06-15",
                raw_notes="n",
                action_items=[
                    ReportActionItem(text="AI Lead to-do", domain_id=domain_id,
                                     domain="signal")
                ],
            ),
        )
        report_id = row["id"]
        assert len(_action_item_rows()) == 1

        # The stored report_json round-trips the action item; re-applying it on
        # edit must still leave exactly ONE row (create-once, not re-folded).
        replay_report_edit(
            conn,
            report_id,
            ReportDocument(
                champion="Dana",
                meeting_date="2026-06-15",
                raw_notes="n",
                action_items=[
                    ReportActionItem(text="AI Lead to-do", domain_id=domain_id,
                                     domain="signal")
                ],
            ),
        )
        assert len(_action_item_rows()) == 1, "no duplicate action item on edit"
    finally:
        conn.close()


# ── report-derived action items carry note through the engine ──────────────────

def test_report_action_item_note_persisted(seeded):
    team_id, domain_id = seeded
    conn = db.get_connection()
    try:
        fan_out_report(
            conn,
            team_id,
            ReportDocument(
                champion="Dana",
                meeting_date="2026-06-15",
                raw_notes="n",
                action_items=[
                    ReportActionItem(text="AI Lead to-do", note="remember X",
                                     domain_id=domain_id, domain="signal")
                ],
            ),
        )
        row = conn.execute(
            "SELECT note FROM action_item WHERE text = 'AI Lead to-do'"
        ).fetchone()
        assert row["note"] == "remember X"
    finally:
        conn.close()
