"""QA driver — hits the SAME localhost endpoints the UI calls (1-1 with clicking).

create team  == Manage > create team
extract+add  == Smart domain extract > accept
draft        == Create Report > Draft   (POST /api/reports/draft)
save         == Create Report > Confirm (POST /api/reports?team_id=)
"""
import json, urllib.request, urllib.error

BASE = "http://127.0.0.1:8000/api"


def _req(method, path, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def create_team(name, champion, start_date):
    return _req("POST", "/teams",
                {"name": name, "champion_name": champion,
                 "champion_start_date": start_date})


def extract_and_create_domains(team_id, text):
    st, res = _req("POST", "/domains/extract", {"text": text})
    if st != 200:
        return st, res
    created = []
    for p in res["domains"]:
        s2, d = _req("POST", "/domains",
                     {"team_id": team_id, "name": p["name"],
                      "description": p.get("description"),
                      "priority": (str(p["priority"]) if p.get("priority") is not None else None)})
        created.append((d.get("name") if isinstance(d, dict) else d, p.get("priority"), s2))
    return st, created


def draft(team_id, notes):
    return _req("POST", "/reports/draft", {"team_id": team_id, "notes": notes})


def save(team_id, doc):
    return _req("POST", f"/reports?team_id={team_id}", doc)


def team_page(team_id):
    return _req("GET", f"/teams/{team_id}/page")
