"""Wave 19 — ADVERSARIAL RBAC test suite for the AI Adoption Tracker.

This suite actively tries to BREAK the access controls (auth + read-scope) by
driving the real FastAPI app through ``fastapi.testclient.TestClient`` against a
THROWAWAY SQLite database. It never touches the user's real ``tracker.db``:
``db.DB_PATH`` is monkeypatched to a temp file BEFORE ``init_db`` runs (the app's
lifespan seeds ``admin`` + ``manager`` into the temp DB), so ``import app`` +
startup + every request hit the throwaway.

Setup (as admin, through the real API — exercises provisioning):
  * Create Team A (champion "Noa") and Team B (champion "Eli") via POST /api/teams
    → auto-provisions scoped read-only users ``noa`` / ``eli``.
  * Under EACH team add a domain + task + artifact + saved report + action item
    (domain via the API, the rest fanned out via POST /api/reports).

The adversarial matrix asserts EXACT status codes; a wrong outcome is a finding.

Runnable two ways (both self-contained; build + tear down their own temp DB):
    python3 tests/test_rbac_adversarial.py       # prints a PASS/FAIL table
    python3 -m pytest tests/test_rbac_adversarial.py -q
"""

from __future__ import annotations

import contextlib
import hashlib
import pathlib
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

# Ensure src/backend/ is importable when run directly.
_BACKEND = pathlib.Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import db  # noqa: E402

REAL_DB = _BACKEND / "tracker.db"
SCHEMA = _BACKEND / "schema.sql"

MEETING_DATE = "2026-06-01"


# ── result harness ────────────────────────────────────────────────────────────

class Results:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, bool, str]] = []

    def check(self, section: str, name: str, ok: bool, detail: str = "") -> None:
        self.rows.append((section, name, ok, detail))

    def eq(self, section: str, name: str, actual, expected) -> None:
        ok = actual == expected
        self.check(section, name, ok, "" if ok else f"expected {expected!r}, got {actual!r}")

    def status(self, section: str, name: str, resp, expected) -> None:
        """Assert an HTTP response status; on mismatch include method+url+body."""
        actual = resp.status_code
        if isinstance(expected, (set, tuple, list)):
            ok = actual in expected
            exp_s = f"in {sorted(expected)}"
        else:
            ok = actual == expected
            exp_s = str(expected)
        detail = ""
        if not ok:
            body = resp.text[:180].replace("\n", " ")
            detail = (
                f"{resp.request.method} {resp.request.url.path} — "
                f"expected {exp_s}, got {actual} | body={body}"
            )
        self.check(section, name, ok, detail)

    # ── reporting ──
    def summary(self) -> tuple[int, int]:
        passed = sum(1 for _, _, ok, _ in self.rows if ok)
        failed = len(self.rows) - passed
        return passed, failed

    def render(self) -> str:
        out: list[str] = []
        sections: dict[str, list[tuple[str, bool, str]]] = {}
        for section, name, ok, detail in self.rows:
            sections.setdefault(section, []).append((name, ok, detail))
        out.append("=" * 78)
        out.append("ADVERSARIAL RBAC — PASS/FAIL by section")
        out.append("=" * 78)
        for section, items in sections.items():
            p = sum(1 for _, ok, _ in items if ok)
            f = len(items) - p
            flag = "OK  " if f == 0 else "FAIL"
            out.append(f"\n[{flag}] {section}   ({p} passed / {f} failed)")
            for name, ok, detail in items:
                mark = "PASS" if ok else "FAIL <<< FIX NOW"
                line = f"    {mark}  {name}"
                if not ok and detail:
                    line += f"\n            {detail}"
                out.append(line)
        passed, failed = self.summary()
        out.append("\n" + "-" * 78)
        out.append(f"TOTAL: {passed} passed, {failed} failed, {len(self.rows)} assertions")
        out.append("-" * 78)
        return "\n".join(out)


# ── low-level helpers over the throwaway DB ───────────────────────────────────

def _db_scalar(sql: str, params: tuple = ()):  # read one value from temp DB
    conn = sqlite3.connect(db.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(sql, params).fetchone()
        return row[0] if row is not None else None
    finally:
        conn.close()


def _db_exec(sql: str, params: tuple = ()) -> None:  # mutate temp DB (test fixtures)
    conn = sqlite3.connect(db.DB_PATH)
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(c: TestClient, username: str, password: str):
    return c.post("/api/auth/login", json={"username": username, "password": password})


def _token(c: TestClient, username: str, password: str) -> str:
    r = _login(c, username, password)
    assert r.status_code == 200, f"setup login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


def _report_doc(champion: str, dom_id: int, dom_name: str, tag: str) -> dict:
    """A minimal valid ReportDocument that fans out 1 task + 1 artifact + 1 action item."""
    return {
        "champion": champion,
        "meeting_date": MEETING_DATE,
        "participants": [],
        "raw_notes": f"raw notes {tag}",
        "tasks": [
            {
                "task": f"Task {tag}",
                "status": "planned",
                "domain_id": dom_id,
                "domain": dom_name,
            }
        ],
        "artifacts": [
            {
                "artifact": f"Artifact {tag}",
                "type": "skill",
                "change_kind": "added",
                "summary": "an artifact",
                "domain_id": dom_id,
                "domain": dom_name,
            }
        ],
        "action_items": [{"text": f"AI-Lead todo {tag}", "status": "planned"}],
        "discussion": [],
        "issues": [],
    }


# ── the whole suite ───────────────────────────────────────────────────────────

def run_suite(c: TestClient) -> Results:
    R = Results()

    # ══ SETUP (as admin, through the real API) ══════════════════════════════
    admin_tok = _token(c, "admin", "admin")
    A = _admin = _bearer(admin_tok)

    # Team A (champion Noa) + Team B (champion Eli) → auto-provision noa/eli.
    ra = c.post("/api/teams", headers=A, json={"name": "Team A", "champion_name": "Noa"})
    rb = c.post("/api/teams", headers=A, json={"name": "Team B", "champion_name": "Eli"})
    R.status("SETUP", "admin create Team A -> 201", ra, 201)
    R.status("SETUP", "admin create Team B -> 201", rb, 201)
    team_a = ra.json()["id"]
    team_b = rb.json()["id"]

    # A domain under each team.
    da = c.post("/api/domains", headers=A, json={"team_id": team_a, "name": "DomA"})
    db_ = c.post("/api/domains", headers=A, json={"team_id": team_b, "name": "DomB"})
    R.status("SETUP", "admin create DomA -> 201", da, 201)
    R.status("SETUP", "admin create DomB -> 201", db_, 201)
    dom_a = da.json()["id"]
    dom_b = db_.json()["id"]

    # A saved report each (fans out task + artifact + action item).
    sa = c.post(
        "/api/reports",
        headers=A,
        params={"team_id": team_a},
        json=_report_doc("Noa", dom_a, "DomA", "A"),
    )
    sb = c.post(
        "/api/reports",
        headers=A,
        params={"team_id": team_b},
        json=_report_doc("Eli", dom_b, "DomB", "B"),
    )
    R.status("SETUP", "admin save report A -> 201", sa, 201)
    R.status("SETUP", "admin save report B -> 201", sb, 201)
    report_a = sa.json()["report"]["id"]
    report_b = sb.json()["report"]["id"]

    # Capture fanned-out ids straight from the throwaway DB.
    task_a = _db_scalar("SELECT id FROM task WHERE name = 'Task A'")
    task_b = _db_scalar("SELECT id FROM task WHERE name = 'Task B'")
    art_a = _db_scalar("SELECT id FROM artifact WHERE name = 'Artifact A'")
    art_b = _db_scalar("SELECT id FROM artifact WHERE name = 'Artifact B'")
    ai_a = _db_scalar("SELECT id FROM action_item WHERE text = 'AI-Lead todo A'")
    ai_b = _db_scalar("SELECT id FROM action_item WHERE text = 'AI-Lead todo B'")
    noa_uid = _db_scalar("SELECT id FROM user WHERE username = 'noa'")
    eli_uid = _db_scalar("SELECT id FROM user WHERE username = 'eli'")
    for label, val in [
        ("task_a", task_a), ("task_b", task_b), ("art_a", art_a), ("art_b", art_b),
        ("ai_a", ai_a), ("ai_b", ai_b), ("noa_uid", noa_uid), ("eli_uid", eli_uid),
    ]:
        R.check("SETUP", f"captured {label}", val is not None, f"{label} is None")
    R.check(
        "SETUP", "noa auto-provisioned scoped to Team A only",
        _db_scalar("SELECT team_id FROM user_team WHERE user_id = ?", (noa_uid,)) == team_a,
    )

    NONEXISTENT = 999_999

    # ══ SECTION 1 — auth basics ═════════════════════════════════════════════
    S = "1. Auth basics"
    R.status(S, "admin login -> 200", _login(c, "admin", "admin"), 200)
    R.status(S, "manager login -> 200", _login(c, "manager", "manager_manager_123"), 200)
    R.status(S, "noa login -> 200", _login(c, "noa", "noa_noa_123"), 200)
    R.status(S, "wrong password -> 401", _login(c, "admin", "nope"), 401)
    R.status(S, "unknown user -> 401", _login(c, "ghost", "whatever"), 401)

    # /me reflects role
    me_admin = c.get("/api/auth/me", headers=A)
    me_mgr = c.get("/api/auth/me", headers=_bearer(_token(c, "manager", "manager_manager_123")))
    me_noa = c.get("/api/auth/me", headers=_bearer(_token(c, "noa", "noa_noa_123")))
    R.eq(S, "/me admin is_admin=True", me_admin.json().get("is_admin"), True)
    R.eq(S, "/me manager read_all=True", me_mgr.json().get("read_all"), True)
    R.check(
        S, "/me noa scoped (not admin, not read_all, teams=[A])",
        me_noa.json().get("is_admin") is False
        and me_noa.json().get("read_all") is False
        and me_noa.json().get("teams") == [team_a],
        f"got {me_noa.json()}",
    )

    # no password_hash leaks anywhere
    users_list = c.get("/api/users", headers=A)
    created = c.post("/api/users", headers=A, json={"username": "leakcheck", "password": "leakleakleak"})
    leak_uid = created.json().get("id") if created.status_code == 201 else None
    reset_resp = (
        c.post(f"/api/users/{leak_uid}/reset-password", headers=A, json={})
        if leak_uid else created
    )
    for label, resp in [
        ("login body", _login(c, "admin", "admin")),
        ("/me body", me_admin),
        ("/users list body", users_list),
        ("create-user body", created),
        ("reset-password body", reset_resp),
    ]:
        R.check(S, f"no password_hash in {label}", "password_hash" not in resp.text,
                "password_hash present in response")
    if leak_uid:
        c.delete(f"/api/users/{leak_uid}", headers=A)  # cleanup

    # missing / malformed / forged tokens
    R.status(S, "no Authorization header -> 401", c.get("/api/auth/me"), 401)
    R.status(S, "malformed 'Basic' scheme -> 401",
             c.get("/api/auth/me", headers={"Authorization": "Basic abc"}), 401)
    R.status(S, "'Bearer' with empty token -> 401",
             c.get("/api/auth/me", headers={"Authorization": "Bearer "}), 401)
    R.status(S, "raw token no scheme -> 401",
             c.get("/api/auth/me", headers={"Authorization": admin_tok}), 401)
    R.status(S, "random forged token -> 401",
             c.get("/api/auth/me", headers=_bearer("deadbeef-not-a-real-token")), 401)

    # ══ SECTION 2 — admin can do everything ═════════════════════════════════
    S = "2. Admin (full access)"
    R.status(S, "GET /teams", c.get("/api/teams", headers=A), 200)
    R.status(S, "GET /team-pages", c.get("/api/team-pages", headers=A), 200)
    R.status(S, "GET /teams/{A}/page", c.get(f"/api/teams/{team_a}/page", headers=A), 200)
    R.status(S, "GET /tasks", c.get("/api/tasks", headers=A), 200)
    R.status(S, "GET /artifacts", c.get("/api/artifacts", headers=A), 200)
    R.status(S, "GET /domains", c.get("/api/domains", headers=A), 200)
    R.status(S, "GET /ai-lead/action-items", c.get("/api/ai-lead/action-items", headers=A), 200)
    R.status(S, "GET /reports/{A}", c.get(f"/api/reports/{report_a}", headers=A), 200)
    # writes
    R.status(S, "PATCH /teams/{A}", c.patch(f"/api/teams/{team_a}", headers=A,
             json={"champion_start_date": "2026-01-01"}), 200)
    tmp_dom = c.post("/api/domains", headers=A, json={"team_id": team_a, "name": "TmpDom"})
    R.status(S, "POST /domains", tmp_dom, 201)
    tmp_dom_id = tmp_dom.json().get("id")
    R.status(S, "PATCH /domains/{tmp}", c.patch(f"/api/domains/{tmp_dom_id}", headers=A,
             json={"description": "x"}), 200)
    R.status(S, "PATCH /tasks/{A}", c.patch(f"/api/tasks/{task_a}", headers=A,
             json={"status": "in-progress"}), 200)
    R.status(S, "PATCH /artifacts/{A}", c.patch(f"/api/artifacts/{art_a}", headers=A,
             json={"summary": "updated"}), 200)
    tmp_ai = c.post("/api/action-items", headers=A, json={"text": "tmp ai", "team_id": team_a})
    R.status(S, "POST /action-items", tmp_ai, 201)
    tmp_ai_id = tmp_ai.json().get("id")
    R.status(S, "PATCH /action-items/{tmp}", c.patch(f"/api/action-items/{tmp_ai_id}",
             headers=A, json={"status": "in-progress"}), 200)
    R.status(S, "DELETE /action-items/{tmp}", c.delete(f"/api/action-items/{tmp_ai_id}", headers=A), 204)
    R.status(S, "DELETE /domains/{tmp}", c.delete(f"/api/domains/{tmp_dom_id}", headers=A), 204)
    # reports draft (503 if LLM unconfigured) / save
    R.status(S, "POST /reports/draft (503 or 200 = allowed)",
             c.post("/api/reports/draft", headers=A, json={"team_id": team_a, "notes": "x"}),
             {200, 503})
    save2 = c.post("/api/reports", headers=A, params={"team_id": team_a},
                   json=_report_doc("Noa", dom_a, "DomA", "A2") | {"meeting_date": "2026-06-08"})
    R.status(S, "POST /reports (new date) -> 201", save2, 201)
    # users portal
    R.status(S, "GET /users", c.get("/api/users", headers=A), 200)
    cu = c.post("/api/users", headers=A, json={"username": "adm_made", "password": "adm_made_pw"})
    R.status(S, "POST /users -> 201", cu, 201)
    cu_id = cu.json().get("id")
    R.status(S, "PATCH /users/{id}", c.patch(f"/api/users/{cu_id}", headers=A,
             json={"is_active": False}), 200)
    R.status(S, "POST /users/{id}/reset-password", c.post(f"/api/users/{cu_id}/reset-password",
             headers=A, json={}), 200)
    R.status(S, "DELETE /users/{id}", c.delete(f"/api/users/{cu_id}", headers=A), 204)

    # ══ SECTION 3 — manager (read_all, zero writes) ═════════════════════════
    S = "3. Manager (read_all)"
    M = _bearer(_token(c, "manager", "manager_manager_123"))
    teams_json = c.get("/api/teams", headers=M).json()
    R.check(S, "GET /teams shows BOTH teams",
            {team_a, team_b} <= {t["id"] for t in teams_json},
            f"got {[t['id'] for t in teams_json]}")
    R.status(S, "GET /teams/{A}/page", c.get(f"/api/teams/{team_a}/page", headers=M), 200)
    R.status(S, "GET /teams/{B}/page", c.get(f"/api/teams/{team_b}/page", headers=M), 200)
    R.status(S, "GET /tasks/{B}", c.get(f"/api/tasks/{task_b}", headers=M), 200)
    R.status(S, "GET /artifacts/{B}", c.get(f"/api/artifacts/{art_b}", headers=M), 200)
    R.status(S, "GET /reports/{B}", c.get(f"/api/reports/{report_b}", headers=M), 200)
    R.status(S, "GET /ai-lead/action-items", c.get("/api/ai-lead/action-items", headers=M), 200)
    ai_json = c.get("/api/ai-lead/action-items", headers=M).json()
    R.check(S, "manager sees BOTH teams' action items",
            {ai_a, ai_b} <= {i["id"] for i in ai_json},
            f"got {[i['id'] for i in ai_json]}")
    # every write -> 403
    mgr_writes = [
        ("POST /teams", c.post("/api/teams", headers=M, json={"name": "X", "champion_name": "Y"})),
        ("PATCH /teams/{A}", c.patch(f"/api/teams/{team_a}", headers=M, json={"name": "X"})),
        ("POST /domains", c.post("/api/domains", headers=M, json={"team_id": team_a, "name": "X"})),
        ("PATCH /domains/{A}", c.patch(f"/api/domains/{dom_a}", headers=M, json={"name": "X"})),
        ("DELETE /domains/{A}", c.delete(f"/api/domains/{dom_a}", headers=M)),
        ("POST /domains/extract", c.post("/api/domains/extract", headers=M, json={"text": "x"})),
        ("PATCH /tasks/{A}", c.patch(f"/api/tasks/{task_a}", headers=M, json={"status": "blocked"})),
        ("PATCH /artifacts/{A}", c.patch(f"/api/artifacts/{art_a}", headers=M, json={"summary": "x"})),
        ("POST /action-items", c.post("/api/action-items", headers=M, json={"text": "x"})),
        ("PATCH /action-items/{A}", c.patch(f"/api/action-items/{ai_a}", headers=M, json={"status": "blocked"})),
        ("DELETE /action-items/{A}", c.delete(f"/api/action-items/{ai_a}", headers=M)),
        ("POST /reports/draft", c.post("/api/reports/draft", headers=M, json={"team_id": team_a, "notes": "x"})),
        ("POST /reports", c.post("/api/reports", headers=M, params={"team_id": team_a},
                                 json=_report_doc("Noa", dom_a, "DomA", "M"))),
        ("PATCH /reports/{A}", c.patch(f"/api/reports/{report_a}", headers=M,
                                       json=_report_doc("Noa", dom_a, "DomA", "M"))),
        ("GET /users", c.get("/api/users", headers=M)),
        ("POST /users", c.post("/api/users", headers=M, json={"username": "z", "password": "zzzzzz"})),
    ]
    for name, resp in mgr_writes:
        R.status(S, f"{name} -> 403", resp, 403)

    # ══ SECTION 4 — scoped champion noa (Team A) — IDOR core ═════════════════
    S = "4a. noa OWN-team reads (200)"
    N = _bearer(_token(c, "noa", "noa_noa_123"))
    R.status(S, "GET /teams/{A}/page", c.get(f"/api/teams/{team_a}/page", headers=N), 200)
    R.status(S, "GET /domains/{A}/page", c.get(f"/api/domains/{dom_a}/page", headers=N), 200)
    R.status(S, "GET /tasks/{A}", c.get(f"/api/tasks/{task_a}", headers=N), 200)
    R.status(S, "GET /artifacts/{A}", c.get(f"/api/artifacts/{art_a}", headers=N), 200)
    R.status(S, "GET /teams/{A}/entities", c.get(f"/api/teams/{team_a}/entities", headers=N), 200)
    R.status(S, "GET /reports/{A}", c.get(f"/api/reports/{report_a}", headers=N), 200)
    R.status(S, "GET /teams/{A}", c.get(f"/api/teams/{team_a}", headers=N), 200)
    R.status(S, "GET /domains/{A_dom}", c.get(f"/api/domains/{dom_a}", headers=N), 200)

    S = "4b. noa CROSS-team by-id (MUST be 403)"
    R.status(S, "GET /teams/{B}/page", c.get(f"/api/teams/{team_b}/page", headers=N), 403)
    R.status(S, "GET /teams/{B}", c.get(f"/api/teams/{team_b}", headers=N), 403)
    R.status(S, "GET /domains/{B}/page", c.get(f"/api/domains/{dom_b}/page", headers=N), 403)
    R.status(S, "GET /domains/{B_dom}", c.get(f"/api/domains/{dom_b}", headers=N), 403)
    R.status(S, "GET /tasks/{B}", c.get(f"/api/tasks/{task_b}", headers=N), 403)
    R.status(S, "GET /artifacts/{B}", c.get(f"/api/artifacts/{art_b}", headers=N), 403)
    R.status(S, "GET /teams/{B}/entities", c.get(f"/api/teams/{team_b}/entities", headers=N), 403)
    R.status(S, "GET /reports/{B}", c.get(f"/api/reports/{report_b}", headers=N), 403)

    S = "4c. noa nonexistent id -> 404 (not 403; existence not leaked)"
    R.status(S, "GET /teams/{X}", c.get(f"/api/teams/{NONEXISTENT}", headers=N), 404)
    R.status(S, "GET /teams/{X}/page", c.get(f"/api/teams/{NONEXISTENT}/page", headers=N), 404)
    R.status(S, "GET /domains/{X}", c.get(f"/api/domains/{NONEXISTENT}", headers=N), 404)
    R.status(S, "GET /domains/{X}/page", c.get(f"/api/domains/{NONEXISTENT}/page", headers=N), 404)
    R.status(S, "GET /tasks/{X}", c.get(f"/api/tasks/{NONEXISTENT}", headers=N), 404)
    R.status(S, "GET /artifacts/{X}", c.get(f"/api/artifacts/{NONEXISTENT}", headers=N), 404)
    R.status(S, "GET /reports/{X}", c.get(f"/api/reports/{NONEXISTENT}", headers=N), 404)
    R.status(S, "GET /teams/{X}/entities", c.get(f"/api/teams/{NONEXISTENT}/entities", headers=N), 404)

    S = "4d. noa LIST filtering (Team B absent)"
    def _absent(resp, forbidden_ids, id_key="id"):
        ids = {row.get(id_key) for row in resp.json()}
        return forbidden_ids.isdisjoint(ids), ids
    tasks_r = c.get("/api/tasks", headers=N)
    ok, ids = _absent(tasks_r, {task_b})
    R.check(S, "GET /tasks excludes Team B task", ok and task_a in ids, f"got {ids}")
    arts_r = c.get("/api/artifacts", headers=N)
    ok, ids = _absent(arts_r, {art_b})
    R.check(S, "GET /artifacts excludes Team B artifact", ok and art_a in ids, f"got {ids}")
    tp_r = c.get("/api/team-pages", headers=N)
    tp_ids = {row["team_id"] for row in tp_r.json()}
    R.check(S, "GET /team-pages excludes Team B", team_b not in tp_ids and team_a in tp_ids, f"got {tp_ids}")
    dom_r = c.get("/api/domains", headers=N)
    dom_ids = {row["id"] for row in dom_r.json()}
    dom_teams = {row["team_id"] for row in dom_r.json()}
    R.check(S, "GET /domains excludes Team B domains", team_b not in dom_teams and dom_a in dom_ids, f"teams={dom_teams}")
    teams_r = c.get("/api/teams", headers=N)
    tids = {row["id"] for row in teams_r.json()}
    R.check(S, "GET /teams excludes Team B", tids == {team_a}, f"got {tids}")
    ail_r = c.get("/api/ai-lead/action-items", headers=N)
    ail_ids = {row["id"] for row in ail_r.json()}
    R.check(S, "GET /ai-lead/action-items excludes Team B", ai_b not in ail_ids and ai_a in ail_ids, f"got {ail_ids}")

    S = "4e. noa autocomplete (Team B name/domains absent)"
    sv_team = c.get("/api/search/values", headers=N, params={"key": "team"}).json()
    team_vals = {v.get("value") for v in sv_team.get("values", [])} | {v.get("label") for v in sv_team.get("values", [])}
    R.check(S, "search team: has 'Team A' not 'Team B'",
            "Team A" in team_vals and "Team B" not in team_vals, f"got {team_vals}")
    sv_dom = c.get("/api/search/values", headers=N, params={"key": "domain"}).json()
    dom_vals = {v.get("value") for v in sv_dom.get("values", [])} | {v.get("label") for v in sv_dom.get("values", [])}
    R.check(S, "search domain: has 'DomA' not 'DomB'",
            "DomA" in dom_vals and "DomB" not in dom_vals, f"got {dom_vals}")

    S = "4f. noa WRITES all -> 403 (incl. editing OWN report)"
    noa_writes = [
        ("POST /teams", c.post("/api/teams", headers=N, json={"name": "X", "champion_name": "Y"})),
        ("PATCH /teams/{A}", c.patch(f"/api/teams/{team_a}", headers=N, json={"name": "X"})),
        ("POST /domains", c.post("/api/domains", headers=N, json={"team_id": team_a, "name": "X"})),
        ("PATCH /domains/{A}", c.patch(f"/api/domains/{dom_a}", headers=N, json={"name": "X"})),
        ("DELETE /domains/{A}", c.delete(f"/api/domains/{dom_a}", headers=N)),
        ("POST /domains/extract", c.post("/api/domains/extract", headers=N, json={"text": "x"})),
        ("PATCH /tasks/{A}", c.patch(f"/api/tasks/{task_a}", headers=N, json={"status": "blocked"})),
        ("PATCH /artifacts/{A}", c.patch(f"/api/artifacts/{art_a}", headers=N, json={"summary": "x"})),
        ("POST /action-items", c.post("/api/action-items", headers=N, json={"text": "x", "team_id": team_a})),
        ("PATCH /action-items/{A}", c.patch(f"/api/action-items/{ai_a}", headers=N, json={"status": "blocked"})),
        ("DELETE /action-items/{A}", c.delete(f"/api/action-items/{ai_a}", headers=N)),
        ("POST /reports/draft", c.post("/api/reports/draft", headers=N, json={"team_id": team_a, "notes": "x"})),
        ("POST /reports", c.post("/api/reports", headers=N, params={"team_id": team_a},
                                 json=_report_doc("Noa", dom_a, "DomA", "N"))),
        ("PATCH /reports/{A} (OWN report!)", c.patch(f"/api/reports/{report_a}", headers=N,
                                                     json=_report_doc("Noa", dom_a, "DomA", "N"))),
        ("GET /users", c.get("/api/users", headers=N)),
        ("POST /users", c.post("/api/users", headers=N, json={"username": "z", "password": "zzzzzz"})),
    ]
    for name, resp in noa_writes:
        R.status(S, f"{name} -> 403", resp, 403)

    # ══ SECTION 5 — session expiry ══════════════════════════════════════════
    S = "5. Session expiry"
    now = datetime.now(timezone.utc)
    # idle: last_used beyond 8h
    t_idle = _token(c, "noa", "noa_noa_123")
    _db_exec("UPDATE session SET last_used_at = ? WHERE token = ?",
             (_iso(now - timedelta(hours=9)), t_idle))
    R.status(S, "idle >8h -> next request 401", c.get("/api/auth/me", headers=_bearer(t_idle)), 401)
    R.check(S, "expired idle session row deleted",
            _db_scalar("SELECT COUNT(*) FROM session WHERE token = ?", (t_idle,)) == 0)
    # absolute: created beyond 24h, last_used recent
    t_abs = _token(c, "noa", "noa_noa_123")
    _db_exec("UPDATE session SET created_at = ?, last_used_at = ? WHERE token = ?",
             (_iso(now - timedelta(hours=25)), _iso(now), t_abs))
    R.status(S, "absolute >24h (recent use) -> 401", c.get("/api/auth/me", headers=_bearer(t_abs)), 401)

    # ══ SECTION 7 — logout revocation (before lockout so noa login still open) ══
    S = "7. Logout revocation"
    t_logout = _token(c, "noa", "noa_noa_123")
    R.status(S, "authenticated before logout -> 200", c.get("/api/auth/me", headers=_bearer(t_logout)), 200)
    R.status(S, "logout -> 204", c.post("/api/auth/logout", headers=_bearer(t_logout)), 204)
    R.status(S, "same token after logout -> 401", c.get("/api/auth/me", headers=_bearer(t_logout)), 401)

    # ══ SECTION 8 — password lifecycle ══════════════════════════════════════
    S = "8. Password lifecycle"
    # ensure a clean login-attempt slate for noa
    _db_exec("DELETE FROM login_attempt WHERE username = 'noa'")
    t_pw = _token(c, "noa", "noa_noa_123")
    ch = c.post("/api/auth/change-password", headers=_bearer(t_pw),
                json={"old_password": "noa_noa_123", "new_password": "noa_new_pw_1"})
    R.status(S, "noa change-password (old->new) -> 204", ch, 204)
    R.status(S, "old password now rejected -> 401", _login(c, "noa", "noa_noa_123"), 401)
    R.status(S, "new password works -> 200", _login(c, "noa", "noa_new_pw_1"), 200)
    # admin resets to provisioning default (no body value)
    _db_exec("DELETE FROM login_attempt WHERE username = 'noa'")
    rp = c.post(f"/api/users/{noa_uid}/reset-password", headers=A, json={})
    R.status(S, "admin reset-password -> 200", rp, 200)
    R.status(S, "noa logs in with reset default -> 200", _login(c, "noa", "noa_noa_123"), 200)

    # ══ SECTION 6 — login lockout (LAST; leaves noa locked, then restore) ════
    S = "6. Login lockout"
    _db_exec("DELETE FROM login_attempt WHERE username = 'noa'")
    fail_codes = [_login(c, "noa", "wrong").status_code for _ in range(5)]
    R.check(S, "5 wrong attempts each -> 401", all(x == 401 for x in fail_codes), f"got {fail_codes}")
    R.status(S, "6th attempt (wrong) -> 429", _login(c, "noa", "wrong"), 429)
    R.status(S, "correct password during lockout -> 429", _login(c, "noa", "noa_noa_123"), 429)
    R.check(S, "locked_until is set in DB",
            _db_scalar("SELECT locked_until FROM login_attempt WHERE username = 'noa'") is not None)
    # backdate the lockout into the past -> login allowed again
    _db_exec("UPDATE login_attempt SET locked_until = ? WHERE username = 'noa'",
             (_iso(datetime.now(timezone.utc) - timedelta(minutes=1)),))
    R.status(S, "after backdating locked_until -> login allowed 200", _login(c, "noa", "noa_noa_123"), 200)

    return R


# ── temp-DB lifecycle + entrypoints ───────────────────────────────────────────

@contextlib.contextmanager
def _throwaway_app():
    """Yield a TestClient wired to a fresh throwaway DB; guarantee the real
    tracker.db is byte-for-byte untouched across the run."""
    before = hashlib.sha256(REAL_DB.read_bytes()).hexdigest() if REAL_DB.exists() else None
    before_mtime = REAL_DB.stat().st_mtime if REAL_DB.exists() else None

    tmpdir = tempfile.mkdtemp(prefix="rbac_adv_")
    orig_path = db.DB_PATH
    try:
        db.DB_PATH = pathlib.Path(tmpdir) / "throwaway.db"
        from app import app  # imported after DB_PATH is redirected
        with TestClient(app) as c:   # lifespan runs init_db against the temp DB
            yield c, before, before_mtime
    finally:
        db.DB_PATH = orig_path
        shutil.rmtree(tmpdir, ignore_errors=True)


def _run_and_report() -> int:
    with _throwaway_app() as (c, before, before_mtime):
        R = run_suite(c)
    print(R.render())

    # HARD RULE — confirm the real DB never moved.
    after = hashlib.sha256(REAL_DB.read_bytes()).hexdigest() if REAL_DB.exists() else None
    after_mtime = REAL_DB.stat().st_mtime if REAL_DB.exists() else None
    db_ok = (before == after) and (before_mtime == after_mtime)
    print("\nREAL tracker.db integrity:")
    print(f"    sha256 before == after : {before == after}")
    print(f"    mtime  before == after : {before_mtime == after_mtime}")
    print(f"    -> real DB {'UNTOUCHED' if db_ok else 'CHANGED !!!'}")

    passed, failed = R.summary()
    return 0 if (failed == 0 and db_ok) else 1


def test_rbac_adversarial():
    """pytest entrypoint — fails if any adversarial assertion fails."""
    with _throwaway_app() as (c, before, _bm):
        R = run_suite(c)
    passed, failed = R.summary()
    after = hashlib.sha256(REAL_DB.read_bytes()).hexdigest() if REAL_DB.exists() else None
    assert before == after, "REAL tracker.db was modified during the test run!"
    assert failed == 0, "\n" + R.render()


if __name__ == "__main__":
    sys.exit(_run_and_report())
