# API Contract — AI Adoption Tracker

> **Frozen in Wave 0 (Agent 0A).** This is the seam Wave-1 implements and the
> frontend stubs against. Derived from `spec.md` §7 (screens) and the Wave-1
> task breakdown. Wave-1 agents implement these endpoints inside their own route
> modules without editing `app.py` (router wiring is pre-wired in Wave 0).

## Conventions

- **Base path:** all endpoints are under `/api`.
- **IDs:** integers (SQLite `INTEGER PRIMARY KEY`).
- **Dates:** ISO-8601 strings `"YYYY-MM-DD"`.
- **Booleans:** JSON `true`/`false` (stored as `0/1` in SQLite).
- **Tags:** JSON array of strings on the wire; stored as JSON text in `artifact.tags`.
- **Content type:** `application/json` for request and response bodies.
- **Errors:** standard FastAPI error envelope `{ "detail": ... }` with an
  appropriate HTTP status (404 not found, 422 validation, 503 LLM not configured).
- **Validation contract:** the report-document shape is defined by
  `report_schema.json` / `models.ReportDocument`.
- **Single user, offline.** No auth, no pagination required at this scale; list
  endpoints return full arrays.

The canonical entity shapes (Team, Champion, Domain, Report, Task, TaskHistory,
Artifact, ArtifactHistory, ActionItem) and the report-document shape are defined
in `src/backend/models.py`. Field names below match those models exactly.

---

## Wave-1 ownership map

| Endpoint group | Route module | Wave-1 agent |
|----------------|--------------|--------------|
| Management (teams / champions / domains CRUD) | `routes/management.py` | 1A |
| Views & lists (pages, task/artifact lists+detail) | `routes/views.py` | 1B |
| Reports (draft / save / edit) | `routes/reports.py` | 1C |
| Search (DSL filtering helpers + autocomplete) | `routes/search.py` | 1D |

---

## 1. Management API (Agent 1A — `routes/management.py`)

CRUD for the three management entities. Each is a list with Add/Edit (spec §7).

### Teams

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/teams` | — | `Team[]` |
| GET | `/api/teams/{id}` | — | `Team` |
| POST | `/api/teams` | `TeamCreate` | `Team` (201) |
| PATCH | `/api/teams/{id}` | `TeamUpdate` (partial) | `Team` |

`TeamCreate` / `Team` fields: `name`, `cc_baseline` (raw starting-point text,
optional), `baseline_date` (optional). `cc_baseline` carries the team's one-time
Claude Code maturity snapshot (spec §3).

```jsonc
// Team
{ "id": 1, "name": "Radar", "cc_baseline": "people using CC raw, no skills", "baseline_date": "2026-06-01" }
```

### Champions

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/champions` | — | `Champion[]` (optional `?team_id=` filter) |
| GET | `/api/champions/{id}` | — | `Champion` |
| POST | `/api/champions` | `ChampionCreate` | `Champion` (201) |
| PATCH | `/api/champions/{id}` | `ChampionUpdate` (partial) | `Champion` |

Fields: `name`, `team_id`, `start_date`, `end_date` (nullable — null = active).

```jsonc
// Champion
{ "id": 1, "name": "Dana", "team_id": 1, "start_date": "2026-06-01", "end_date": null }
```

### Domains

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/domains` | — | `Domain[]` (optional `?team_id=` / `?champion_id=` filter) |
| GET | `/api/domains/{id}` | — | `Domain` |
| POST | `/api/domains` | `DomainCreate` | `Domain` (201) |
| PATCH | `/api/domains/{id}` | `DomainUpdate` (partial) | `Domain` |

Fields: `team_id`, `champion_id`, `name`, `description`, `scope`, `priority`
(integer), `cross_domain` (free text).

```jsonc
// Domain
{ "id": 1, "team_id": 1, "champion_id": 1, "name": "signal-processing",
  "description": "...", "scope": "...", "priority": 2, "cross_domain": "..." }
```

---

## 2. Views & lists API (Agent 1B — `routes/views.py`)

### Teams index — `GET /api/team-pages`

The landing list (route `/`, spec §7 "teams index"). One entry per **team page**,
i.e. one per (team, champion) pair — a team split across two champions yields two
entries, "keyed internally by champion, labeled by team" (spec §7). Each entry
links to `/teams/:championId`. No search bar / no metrics (spec §7: "browse").

> **Path choice:** `/api/team-pages` (not `/api/teams/index`) — `/api/teams/{id}`
> already exists, so `/api/teams/index` would collide with the `{id}` path param
> (`index` parsed as an id). A distinct collection path avoids the ambiguity.

```jsonc
[
  { "team_id": 1, "team_name": "Radar", "champion_id": 1, "champion_name": "Dana", "domain_count": 3 }
]
```

- Fields: `team_id`, `team_name`, `champion_id`, `champion_name` (the page key/label),
  and `domain_count` (number of that champion's domains — enough to render the list).
- Which champion(s) a team contributes when it has had several (current vs historical)
  is the same 1B decision as `{id}/page` champion selection — see uncertainties.

### Team page — `GET /api/teams/{id}/page`

The hub: **one champion's portfolio of domains, named by the team** (spec §7).
Returns the team, its (current) champion, the champion's domains each with their
current tasks/artifacts plus full week-by-week story, the champion's reports,
action items, and the **all-team gutter** (artifacts with `domain_id = null`).

```jsonc
{
  "team": { "id": 1, "name": "Radar", "cc_baseline": "...", "baseline_date": "2026-06-01" },
  "champion": { "id": 1, "name": "Dana", "team_id": 1, "start_date": "2026-06-01", "end_date": null },
  "domains": [
    {
      "domain": { "id": 1, "team_id": 1, "champion_id": 1, "name": "signal-processing", "priority": 2, "...": "..." },
      "tasks": [ /* Task[] current state */ ],
      "task_history": [ /* TaskHistory[] ordered by meeting_date */ ],
      "artifacts": [ /* Artifact[] with domain_id = this domain */ ],
      "artifact_history": [ /* ArtifactHistory[] ordered by meeting_date */ ]
    }
  ],
  "all_team_artifacts": [ /* Artifact[] where domain_id is null (the gutter) */ ],
  "reports": [ /* Report[] for this champion, newest first */ ],
  "action_items": [ /* ActionItem[] for this champion's reports */ ]
}
```

> A team split across two champions yields **two pages** (keyed by champion,
> labeled by team). How `{id}/page` selects the champion when a team has had
> several (current vs historical) is a Wave-1 1B decision — see uncertainties.

### Domain page — `GET /api/domains/{id}/page`

Drill into a single domain: current tasks/artifacts + full history.

```jsonc
{
  "domain": { "id": 1, "...": "..." },
  "tasks": [ /* Task[] current */ ],
  "task_history": [ /* TaskHistory[] ordered by date */ ],
  "artifacts": [ /* Artifact[] for this domain */ ],
  "artifact_history": [ /* ArtifactHistory[] ordered by date */ ]
}
```

### Tasks list — `GET /api/tasks`

All tasks; **accepts the `q` DSL filter** (see §4). Each row expands to its
week-by-week journey on the detail endpoint.

- Query params: `q` (optional DSL string — see §4).
- Response: `Task[]` (current-state rows matching the filter).

### Task detail — `GET /api/tasks/{id}`

```jsonc
{
  "task": { "id": 2, "domain_id": 1, "name": "Clutter map", "status": "in-progress",
            "owner": "Dana", "started_on": "2026-06-01", "ended_on": null },
  "history": [ /* TaskHistory[] ordered by meeting_date — the journey */ ]
}
```

### Artifacts list — `GET /api/artifacts`

All artifacts; **accepts the `q` DSL filter** (see §4). Not a company-wide dump —
filtered (spec §7).

- Query params: `q` (optional DSL string — see §4).
- Response: `Artifact[]` (current-state rows matching the filter).

### Artifact detail — `GET /api/artifacts/{id}`

Feeds the **detail modal**: summary + full data + change history.

```jsonc
{
  "artifact": { "id": 5, "team_id": 1, "domain_id": 1, "name": "clutter-review",
                "type": "skill", "tags": ["under_test"], "summary": "..." },
  "history": [ /* ArtifactHistory[] ordered by meeting_date */ ]
}
```

> **Wave-10 addition:** both detail envelopes now also carry `domain`
> (`str | null`) — the placement's domain **name** (null when an artifact's
> `domain_id` is null = the team-wide gutter), resolved via one
> `SELECT name FROM domain WHERE id = ?`. History rows are unchanged
> (dates-only `meeting_date`). Shapes become `{ task, domain, history }` and
> `{ artifact, domain, history }`.

### Team entities (picker source) — `GET /api/teams/{team_id}/entities` (Wave 10)

Feeds the report editor's `@`-task / `#`-artifact mention picker. Returns the
team's existing tasks + artifacts as a **picker-shaped projection** (NOT the full
entity models — only the fields the picker renders plus the resolved domain
name).

```jsonc
{
  "tasks": [
    { "id": 1, "name": "Clutter map", "status": "in-progress",
      "domain_id": 1, "domain": "signal-processing" }
  ],
  "artifacts": [
    { "id": 5, "name": "clutter-review", "type": "skill",
      "domain_id": 1, "domain": "signal-processing" },
    { "id": 9, "name": "team-context-pack", "type": "context",
      "domain_id": null, "domain": null }   // team-wide (gutter)
  ]
}
```

- **Task → team:** `task → domain → domain.team_id` (tasks have no direct
  `team_id`); `domain` = domain name (always present for tasks, since
  `task.domain_id` is NOT NULL). `status` is the enum string value.
- **Artifact → team:** `artifact.team_id`; **includes team-wide artifacts**
  (`domain_id` null → `domain` null) via a LEFT JOIN. `type` is the enum string
  value.
- `404 { "detail": "Team not found" }` if the team does not exist; an **empty
  team** returns `{ "tasks": [], "artifacts": [] }` (200).

### Task edit (current-state) — `PATCH /api/tasks/{id}` (Wave 10)

Manager edit of a task's **current state**. Accepts `status`, `owner`,
`domain_id`, `started_on`, `ended_on` (partial). Returns the updated `Task`.
**Writes NO `task_history` row** — this edit is intentionally **un-journaled**:
reports remain the only thing that journals history (a later report-edit replay
may recompute these fields).

```jsonc
// request — all fields optional (partial PATCH)
{ "status": "blocked", "owner": "Maya", "domain_id": 1,
  "started_on": "2026-06-01", "ended_on": null }
```

- `status` is validated against the task-status enum (`planned|in-progress|
  finished_successfully|finished_with_issues|blocked|abandoned`); an invalid value
  → `422`.
- `domain_id` is NOT NULL for a task — null → `422 "domain_id cannot be null"`.
  A supplied `domain_id` must exist (else `422 "Unknown domain id N"`) and its
  `team_id` must equal the task's current team (resolved via the task's current
  domain) else `422` cross-team.
- `404 { "detail": "Task not found" }` if the task is missing.

### Artifact edit (current-state) — `PATCH /api/artifacts/{id}` (Wave 10)

Entity-page edit. Accepts `name`, `type`, `tags`, `summary`, `domain_id`
(partial; `domain_id` nullable, null = team-wide). Returns the updated `Artifact`
(`tags` parsed back to a list). **Writes NO `artifact_history` row.**

```jsonc
// request — all fields optional (partial PATCH)
{ "name": "clutter-review", "type": "skill",
  "tags": ["under_test"], "summary": "...", "domain_id": 1 }
```

- `type` is validated by the `ArtifactType` enum (`agent` / `skill` / `hook` /
  `context`); an unknown value → `422 "Unknown artifact type '…'"`. `name` /
  `type` may not be set to null (`422 "<field> cannot be null"`).
- `tags` is re-serialized to JSON text on write and round-trips back as a list.
- A non-null `domain_id` must exist and its `team_id` must equal
  `artifact.team_id` else `422`; **null is allowed** (team-wide / gutter).
- `404 { "detail": "Artifact not found" }` if the artifact is missing.

---

## 3. Reports API (Agent 1C — `routes/reports.py`)

The report document shape (request + response bodies marked `ReportDocument`) is
`report_schema.json` / `models.ReportDocument` (§4 JSON). Note `discussion` and
`issues` are ordered **lists** of free-text items (`list[str]`, each entry one
discussion point / one issue; an item may itself contain newlines), not a single
joined string.

### Draft — `POST /api/reports/draft`

The **only** creation path: raw notes -> structured report via the LLM adapter.
**Not saved.** Returns the drafted `ReportDocument` for preview/edit.

- Request:
  ```jsonc
  { "champion_id": 1, "notes": "<raw meeting notes pasted verbatim>" }
  ```
  (The adapter receives `notes` plus a server-built `context` dict of the
  champion's current domains/tasks/artifacts so the model can map/de-dup.)
- Response: a `ReportDocument` (unsaved draft).
- **503** `{ "detail": "LLM endpoint not configured" }` when no air-gapped
  endpoint is wired (`llm.interface.LLMNotConfiguredError`). Spec §4/§10: the
  endpoint is required to create reports.

### Confirm / save — `POST /api/reports`

Confirm the previewed draft -> write it. One transaction (spec §5/§6 fan-out):
insert the `report` row (with full `report_json` + `schema_version`), upsert
task/artifact current state, append `task_history` / `artifact_history` rows,
insert `action_item` rows. Entities matched by name within domain.

- Request: a `ReportDocument` (the confirmed/edited draft).
- Response:
  ```jsonc
  { "report": { "id": 42, "champion_id": 1, "meeting_date": "2026-06-15",
                "report_json": "{...}", "schema_version": 1 } }
  ```
  (201). Wave-1 may include the touched task/artifact ids; left to 1C.

### Get one — `GET /api/reports/{id}`

Fetch a saved report so the edit form can bind to its structured JSON (spec §4
"a report can be reopened in the same form"). The form parses `report_json` to
rebuild the `ReportDocument`; no LLM needed.

- Response: the `report` row, same shape/wrapper as save/patch — `report_json`
  stays a JSON-encoded **string** (`models.Report.report_json: str`):
  ```jsonc
  { "report": { "id": 42, "champion_id": 1, "meeting_date": "2026-06-15",
                "report_json": "{...}", "schema_version": 1 } }
  ```
- **404** `{ "detail": ... }` when no report with that id exists.

### Edit + replay — `PATCH /api/reports/{id}`

Reopen a saved report's structured JSON, edit fields (not the raw notes), re-save
(spec §4 "Updating a saved report"). Implementation: delete this report's history
rows, re-apply the edited report, recompute touched current-state by replaying
that champion's reports in date order.

- Request: the full edited `ReportDocument`.
- Response: the updated `report` row (same shape as save).
- Works **without** the LLM endpoint (editing needs no drafting).

---

## 4. Search (Agent 1D — `routes/search.py`) and the `q` DSL

The search bar is a gradual `key:value` chip bar used on **Artifacts** and
**Tasks** only (spec §7). It is the copied SoccerSmartBet DSL adapted to SQLite.

### The `q` parameter shape

`q` is a single string of space-separated `key:value` clauses, e.g.:

```
team:radar domain:signal-processing status:blocked
```

- **Keys:** `team`, `domain`, `type`, `tag`, `status`, `date`.
- **Value matching by key:**
  - `team` — team name or id; matches the artifact/task's team (task team reached
    via `task -> domain -> team`).
  - `domain` — domain name or id.
  - `type` — artifact type enum (`agent|skill|hook|context`). **Artifacts only.**
  - `tag` — a tag string; matches if present in the artifact's `tags` JSON array.
    **Artifacts only.**
  - `status` — task status enum (`planned|in-progress|finished_successfully|
    finished_with_issues|blocked|abandoned`). **Tasks only.**
  - `date` — ISO date; semantics (e.g. activity on/around a date via history) are
    a Wave-1 1D decision.
- **Multiple clauses are AND-combined.** Repeating a key (`tag:a tag:b`) is 1D's
  call (AND vs OR) — flag in 1D.
- **Unknown/inapplicable keys** (e.g. `status:` on artifacts) -> 1D decides
  ignore vs 422; recommend 422 for an unknown key, ignore for inapplicable.
- Both `/api/tasks` and `/api/artifacts` accept `q` as an optional query param;
  absent/empty `q` returns the full list. The filter round-trips to the URL for
  shareable views (frontend concern).

### Autocomplete — `GET /api/search/values?key=...`

Powers the chip bar's value suggestions. One required query param `key` (one of
the six keys above). Returns the candidate values for that key drawn from the
live tables.

- Request: `GET /api/search/values?key=team`
- Response shape (a tagged result so the chip UI can render enum vs free vs date):
  ```jsonc
  {
    "key": "team",
    "kind": "enum",            // "enum" | "free" | "date" | "numeric" — 1D maps per key
    "values": [
      { "value": "radar", "label": "Radar" },
      { "value": "platform", "label": "Platform" }
    ]
  }
  ```
  - `team`, `domain` -> `kind: "enum"`, values from the `team` / `domain` tables.
  - `type` -> `kind: "enum"`, the fixed artifact-type set.
  - `status` -> `kind: "enum"`, the fixed task-status set.
  - `tag` -> `kind: "free"` (or enum of seen tags), the known + free-text tags
    (spec §5 fixed-tag set plus free-text); 1D decides.
  - `date` -> `kind: "date"`, no fixed value list (the UI shows a date picker).

> The exact `kind` labels and whether `label` differs from `value` are 1D's to
> finalise; the frontend (2D) only needs `key`, `kind`, and a `values` array of
> `{value, label}`. Flagged as an uncertainty.

---

## Wave-1 implementation notes

Deferred decisions surfaced in the Wave-0 review, recorded so Wave-1 owners pick
them up (no redesign here):

- **`q` DSL repeated key** (`tag:a tag:b`) = **AND** within a key (1D).
- **Unknown `q` key** -> **422**; **inapplicable** key (e.g. `status:` on artifacts) ->
  **ignored** (1D).
- **`date` key semantics** (activity on/around a date via history) owned by **1D**.
- **`report_json` is a JSON-encoded string on the wire** (`models.Report.report_json: str`):
  clients must `JSON.parse` it to read the document.
- **`POST /api/reports` handler path nuance:** the create route lives at the router's
  collection root; mind the `routes/reports.py` router prefix so it resolves to
  `/api/reports` (not a doubled prefix) when wired in `app.py` (1C).

## Health

`GET /api/health` -> `{ "status": "ok" }` (added in Wave 0; for boot checks).
