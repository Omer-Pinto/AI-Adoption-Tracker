"""Smoke test for the AI Adoption Tracker backend.

Run against a freshly-seeded DB + booted backend:
    cd /path/to/repo
    python src/backend/seed.py               # seed a fresh DB
    cd src/backend && uvicorn app:app --port 8000 &
    python scripts/smoke.py
    kill %1

The script reports PASS/FAIL per check and exits non-zero on any failure.
API-level assertions only — browser UI (modals/search interactions) was
verified separately.

Checks:
  1. Health endpoint returns ok
  2. GET /api/teams/{champion_id}/page — Radar team page has expected shape
  3. GET /api/domains/{id}/page — signal-processing domain page has tasks + artifacts
  4. GET /api/tasks — all tasks returned (>= 3 expected from seed)
  5. GET /api/artifacts — all artifacts returned (>= 2 expected from seed)
  6. §6 read-back: active tasks are exactly Clutter map + Doppler check
  7. §6 read-back: CFAR tuning is abandoned with ended_on = 2026-06-15
  8. Search ?q=status:in-progress — returns only in-progress tasks, no 500
  9. Search ?q=type:skill on artifacts — returns skill artifacts, no 500
 10. Edit/replay: PATCH /api/reports/{id} recomputes; no duplicate history rows
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"

# ── helpers ───────────────────────────────────────────────────────────────────

_results: list[tuple[str, bool, str]] = []  # (label, passed, detail)


def check(label: str, passed: bool, detail: str = "") -> None:
    _results.append((label, passed, detail))
    status = "PASS" if passed else "FAIL"
    suffix = f" — {detail}" if detail else ""
    print(f"  [{status}] {label}{suffix}")


def get(path: str, params: str = "") -> tuple[int, object]:
    url = f"{BASE}{path}"
    if params:
        url += ("&" if "?" in url else "?") + params
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, body


def patch(path: str, body: dict) -> tuple[int, object]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=data,
        method="PATCH",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return exc.code, body


# ── check 1: health ───────────────────────────────────────────────────────────

def check_health() -> None:
    print("\n--- Check 1: Health endpoint ---")
    code, body = get("/api/health")
    check("GET /api/health returns 200", code == 200, f"status={code}")
    if isinstance(body, dict):
        check("health body has status=ok", body.get("status") == "ok", str(body))


# ── check 2: team page ────────────────────────────────────────────────────────

def check_team_page() -> dict | None:
    print("\n--- Check 2: Team page (Radar/Dana) ---")
    # First resolve the champion id for Dana
    code, champions = get("/api/champions")
    if code != 200 or not isinstance(champions, list):
        check("GET /api/champions", False, f"status={code}")
        return None

    dana = next((c for c in champions if c.get("name") == "Dana"), None)
    if dana is None:
        check("Dana champion exists", False, "not found")
        return None
    check("Dana champion exists", True, f"id={dana['id']}")

    champion_id = dana["id"]
    code, page = get(f"/api/teams/{champion_id}/page")
    check(f"GET /api/teams/{champion_id}/page returns 200", code == 200, f"status={code}")
    if code != 200 or not isinstance(page, dict):
        return None

    check("team page has team block", "team" in page, str(list(page.keys())))
    check("team name is Radar", page.get("team", {}).get("name") == "Radar",
          page.get("team", {}).get("name", ""))
    check("team page has domains list", isinstance(page.get("domains"), list),
          str(type(page.get("domains"))))
    check("at least one domain", len(page.get("domains", [])) >= 1,
          f"count={len(page.get('domains', []))}")
    check("team page has reports", len(page.get("reports", [])) >= 1,
          f"reports={len(page.get('reports', []))}")
    check("team page has action_items", isinstance(page.get("action_items"), list))

    return page


# ── check 3: domain page ──────────────────────────────────────────────────────

def check_domain_page() -> dict | None:
    print("\n--- Check 3: Domain page (signal-processing) ---")
    code, domains = get("/api/domains")
    if code != 200 or not isinstance(domains, list):
        check("GET /api/domains", False, f"status={code}")
        return None

    sig = next((d for d in domains if d.get("name") == "signal-processing"), None)
    if sig is None:
        check("signal-processing domain exists", False, "not found")
        return None
    check("signal-processing domain exists", True, f"id={sig['id']}")

    domain_id = sig["id"]
    code, page = get(f"/api/domains/{domain_id}/page")
    check(f"GET /api/domains/{domain_id}/page returns 200", code == 200, f"status={code}")
    if code != 200 or not isinstance(page, dict):
        return None

    check("domain page has tasks", isinstance(page.get("tasks"), list),
          f"count={len(page.get('tasks', []))}")
    check("domain page has artifacts", isinstance(page.get("artifacts"), list),
          f"count={len(page.get('artifacts', []))}")
    check("domain page has task_history", isinstance(page.get("task_history"), list),
          f"count={len(page.get('task_history', []))}")
    check("domain page has artifact_history", isinstance(page.get("artifact_history"), list),
          f"count={len(page.get('artifact_history', []))}")

    return page


# ── check 4: task list ────────────────────────────────────────────────────────

def check_task_list() -> list | None:
    print("\n--- Check 4: Task list ---")
    code, tasks = get("/api/tasks")
    check("GET /api/tasks returns 200", code == 200, f"status={code}")
    if code != 200 or not isinstance(tasks, list):
        return None
    check("at least 3 tasks from seed", len(tasks) >= 3, f"count={len(tasks)}")
    return tasks


# ── check 5: artifact list ────────────────────────────────────────────────────

def check_artifact_list() -> list | None:
    print("\n--- Check 5: Artifact list ---")
    code, artifacts = get("/api/artifacts")
    check("GET /api/artifacts returns 200", code == 200, f"status={code}")
    if code != 200 or not isinstance(artifacts, list):
        return None
    check("at least 2 artifacts from seed", len(artifacts) >= 2,
          f"count={len(artifacts)}")
    return artifacts


# ── check 6 & 7: §6 read-back ─────────────────────────────────────────────────

def check_section6_readback(tasks: list | None) -> None:
    """§6 read-back scoped to signal-processing domain (Radar/Dana).

    The full /api/tasks list includes Platform/Eli tasks as well; we scope
    the active-task assertion to the signal-processing domain by resolving its
    domain_id and filtering the task list accordingly.
    """
    print("\n--- Checks 6+7: §6 read-back ---")
    if tasks is None:
        check("§6 read-back (skipped — no task list)", False, "dependency failed")
        return

    # Resolve signal-processing domain_id.
    code, domains = get("/api/domains")
    sig_domain_id = None
    if code == 200 and isinstance(domains, list):
        sig = next((d for d in domains if d.get("name") == "signal-processing"), None)
        sig_domain_id = sig["id"] if sig else None

    if sig_domain_id is None:
        check("signal-processing domain resolved for §6 check", False, "not found")
        return

    terminal_statuses = {"finished_successfully", "finished_with_issues", "abandoned"}
    sig_tasks = [t for t in tasks if t.get("domain_id") == sig_domain_id]
    active = [t for t in sig_tasks if t.get("status") not in terminal_statuses]
    active_names = {t["name"] for t in active}
    expected_active = {"Clutter map", "Doppler check"}

    check(
        "active signal-processing tasks are exactly Clutter map + Doppler check",
        active_names == expected_active,
        f"got {active_names}",
    )

    cfar = next((t for t in sig_tasks if t.get("name") == "CFAR tuning"), None)
    check("CFAR tuning is on record", cfar is not None, "not found in signal-processing task list")
    if cfar:
        check(
            "CFAR tuning status is abandoned",
            cfar.get("status") == "abandoned",
            f"status={cfar.get('status')}",
        )
        check(
            "CFAR tuning ended_on is 2026-06-15",
            cfar.get("ended_on") == "2026-06-15",
            f"ended_on={cfar.get('ended_on')}",
        )


# ── check 8: search tasks ?q=status:in-progress ───────────────────────────────

def check_search_tasks() -> None:
    print("\n--- Check 8: Search ?q=status:in-progress ---")
    code, result = get("/api/tasks", "q=status:in-progress")
    check("GET /api/tasks?q=status:in-progress — no 500", code not in (500, 502, 503),
          f"status={code}")
    if code == 200 and isinstance(result, list):
        bad = [t for t in result if t.get("status") != "in-progress"]
        check(
            "all returned tasks are in-progress",
            len(bad) == 0,
            f"{len(bad)} non-in-progress rows" if bad else f"{len(result)} tasks",
        )
    elif code == 422:
        # Search DSL may reject unknown syntax — report the detail but don't crash.
        check("search DSL accepted status:in-progress", False, f"422 parse error: {result}")


# ── check 9: search artifacts ?q=type:skill ───────────────────────────────────

def check_search_artifacts() -> None:
    print("\n--- Check 9: Search ?q=type:skill on artifacts ---")
    code, result = get("/api/artifacts", "q=type:skill")
    check("GET /api/artifacts?q=type:skill — no 500", code not in (500, 502, 503),
          f"status={code}")
    if code == 200 and isinstance(result, list):
        bad = [a for a in result if a.get("type") != "skill"]
        check(
            "all returned artifacts are type=skill",
            len(bad) == 0,
            f"{len(bad)} non-skill rows" if bad else f"{len(result)} artifacts",
        )
    elif code == 422:
        check("search DSL accepted type:skill", False, f"422 parse error: {result}")


# ── check 10: edit + replay ────────────────────────────────────────────────────

def check_edit_replay() -> None:
    print("\n--- Check 10: Edit + replay (no duplicate history rows) ---")

    # Find the second Radar/Dana report (2026-06-15) to edit.
    code, reports_page = get("/api/champions")
    if code != 200 or not isinstance(reports_page, list):
        check("resolve champion for edit", False, f"status={code}")
        return

    dana = next((c for c in reports_page if c.get("name") == "Dana"), None)
    if dana is None:
        check("Dana exists for edit test", False, "not found")
        return

    champ_id = dana["id"]
    code, page = get(f"/api/teams/{champ_id}/page")
    if code != 200 or not isinstance(page, dict):
        check("team page for edit test", False, f"status={code}")
        return

    reports = page.get("reports", [])
    # Reports are newest-first; find the 2026-06-15 one.
    report_0615 = next(
        (r for r in reports if r.get("meeting_date") == "2026-06-15"), None
    )
    if report_0615 is None:
        check("2026-06-15 report found for edit", False,
              f"dates={[r.get('meeting_date') for r in reports]}")
        return
    check("2026-06-15 report found", True, f"id={report_0615['id']}")
    report_id = report_0615["id"]

    # Parse report_json out of the stored report.
    raw_json = report_0615.get("report_json")
    if not raw_json:
        check("report_json present", False, "missing")
        return

    try:
        doc = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        check("report_json is valid JSON", False, str(exc))
        return

    # Add a harmless discussion change so the edit is real.
    doc["discussion"] = "EDITED — demoed a meta-skill and discussed new tooling"

    code, patched = patch(f"/api/reports/{report_id}", doc)
    check(f"PATCH /api/reports/{report_id} returns 200", code == 200,
          f"status={code} body={str(patched)[:200]}")

    if code != 200:
        return

    # Re-fetch tasks and verify no duplication: CFAR tuning should still be
    # abandoned with ended_on = 2026-06-15, not duplicated.
    code2, tasks_after = get("/api/tasks")
    if code2 != 200 or not isinstance(tasks_after, list):
        check("tasks after replay", False, f"status={code2}")
        return

    cfar_rows = [t for t in tasks_after if t.get("name") == "CFAR tuning"]
    check("no duplicate CFAR tuning rows after replay",
          len(cfar_rows) == 1, f"found {len(cfar_rows)} rows")

    if cfar_rows:
        cfar = cfar_rows[0]
        check(
            "CFAR tuning still abandoned after replay",
            cfar.get("status") == "abandoned",
            f"status={cfar.get('status')}",
        )
        check(
            "CFAR tuning ended_on preserved after replay",
            cfar.get("ended_on") == "2026-06-15",
            f"ended_on={cfar.get('ended_on')}",
        )

    # Count active signal-processing tasks after replay — should still be exactly 2.
    terminal_statuses = {"finished_successfully", "finished_with_issues", "abandoned"}
    # Resolve signal-processing domain_id for scoped assertion.
    code_dom, domains_after = get("/api/domains")
    sig_domain_id_after = None
    if code_dom == 200 and isinstance(domains_after, list):
        sig_after = next(
            (d for d in domains_after if d.get("name") == "signal-processing"), None
        )
        sig_domain_id_after = sig_after["id"] if sig_after else None
    if sig_domain_id_after is not None:
        sig_tasks_after = [
            t for t in tasks_after if t.get("domain_id") == sig_domain_id_after
        ]
        active_after = [
            t for t in sig_tasks_after if t.get("status") not in terminal_statuses
        ]
        active_names_after = {t["name"] for t in active_after}
        check(
            "active signal-processing tasks still correct after replay",
            active_names_after == {"Clutter map", "Doppler check"},
            f"active={active_names_after}",
        )
    else:
        check("active signal-processing tasks still correct after replay", False,
              "signal-processing domain not resolved")

    # Check task_history count — fetch detail for CFAR to check no duplicates.
    code3, cfar_detail = get(f"/api/tasks/{cfar_rows[0]['id']}")
    if code3 == 200 and isinstance(cfar_detail, dict):
        history = cfar_detail.get("history", [])
        check(
            "CFAR history has exactly 1 row after replay",
            len(history) == 1,
            f"rows={len(history)}",
        )


# ── summary ───────────────────────────────────────────────────────────────────

def summarise() -> int:
    passed = sum(1 for _, ok, _ in _results if ok)
    total = len(_results)
    failed = total - passed
    print(f"\n{'='*60}")
    print(f"Smoke results: {passed}/{total} passed, {failed} failed")
    if failed:
        print("\nFailed checks:")
        for label, ok, detail in _results:
            if not ok:
                print(f"  FAIL  {label}  ({detail})")
    return 0 if failed == 0 else 1


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"Smoke test against {BASE}")
    check_health()
    team_page = check_team_page()
    check_domain_page()
    tasks = check_task_list()
    check_artifact_list()
    check_section6_readback(tasks)
    check_search_tasks()
    check_search_artifacts()
    check_edit_replay()
    sys.exit(summarise())


if __name__ == "__main__":
    main()
