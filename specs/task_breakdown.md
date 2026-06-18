# AI Adoption Tracker — Task Breakdown

> **Created:** 2026-06-17 | **Status:** Draft | **Branch:** `mvp-spec`
> **Spec:** `specs/spec.md` (authoritative). `mvp/` HTML = visual reference only.
> **Execution:** Sonnet agents by default (per user); escalate only if a task stalls. The orchestrator (main session) **never writes code** — it only plans, dispatches agents, verifies, and cherry-picks. **Every** build task — sequential Wave-0 setup and integration fixes included — is done by an expert agent. The sole orchestrator hands-on action is the `cp` in 0.4, to guarantee the SoccerSmartBet read-only boundary.

## Guiding Principle

**`~/code/home/SoccerSmartBet` is EXTERNAL and READ-ONLY — never modify, import, link, symlink, or path-reference it.** Its DSL search mechanism is **copied** into this repo as an independent module (`src/backend/search/`, `src/frontend/src/search/`) and adapted to SQLite + our fields. Beyond that: **build only what `spec.md` defines** — no invented metrics, no manager dashboard, no advanced query layer beyond the search bar, honest data only. Stack: SQLite + FastAPI (`src/backend/`) + React/Vite/TS (`src/frontend/`).

---

## Wave 0 — Setup (2 agents parallel + 1 orchestrator file-copy)

Foundation that fixes schema/contracts/scaffold so feature agents never touch shared files. Built by agents; the orchestrator only runs the file-copy and verifies. 0A and 0B own disjoint trees (`src/backend/` vs `src/frontend/`) → safe in parallel.

### Agent 0A: Backend foundation
**Type:** `backend-developer` · **Scope:** `src/backend/` (app, db, schema, models, contracts)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 0.1 | Scaffold | FastAPI `app.py` (CORS) with **pre-wired** includes for `routes/{management,views,reports,search}.py` (each exposes `router`); `db.py` (SQLite + run `schema.sql` on startup); `run.sh`; pyproject | |
| 0.2 | Schema | `schema.sql` — every §5 table (artifact has `team_id`, nullable `domain_id`, `summary`) | WAL, FKs, no extra indexes |
| 0.3 | Contracts | `models.py` (entities + report JSON structure §4); `report_schema.json`; `llm/interface.py` (`draft_report(notes, context)->dict` signature + "not configured" stub); `specs/api_contract.md` (endpoints from §7 **incl. the `q` search-param shape**) | freezes the seams |
**Commit:** `Wave 0 Agent 0A: backend foundation`

### Agent 0B: Frontend foundation
**Type:** `frontend-developer` · **Scope:** `src/frontend/`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 0.5a | Scaffold | Vite+React+TS; `AppShell` (sidebar Teams→`/`, Artifacts→`/artifacts`, Tasks→`/tasks`) reusing the `mvp/` look; router with **all routes → stub pages** at fixed paths | no router edits in Wave 3 |
| 0.5b | Primitives | `api.ts` client (stub to the api_contract shape); `Modal`, `DataTable`, `Badge`, working `ArtifactDetailModal` | shared by 3B & 3D |
**Commit:** `Wave 0 Agent 0B: frontend foundation`

### 0.4 — Copy search source (orchestrator `cp` — read-only safety)
Orchestrator copies the SoccerSmartBet search files into this repo as the adaptation base: parser/compiler/autocomplete → `src/backend/search/`; `filter-builder.js` → `src/frontend/src/search/`. **Pure copy** — strip soccer-specific imports; never edit or reference the source tree. (Adaptation happens in 1D / 3D.)

### After Wave 0
- Cherry-pick 0A, 0B. Verify: backend boots with empty routers, schema applies, frontend builds with stub routes.

---

## Wave 1 — Backend (4 agents, parallel; all import Wave-0 models read-only)

### Agent 1A: Management API
**Type:** `backend-developer` · **Scope:** `src/backend/routes/management.py`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Team CRUD | GET/POST/PATCH `/api/teams` (+ cc_baseline) | |
| 2 | Champion CRUD | `/api/champions` (name, team_id, start/end) | end_date nullable |
| 3 | Domain CRUD | `/api/domains` (team_id, champion_id, name, description, scope, priority, cross_domain) | |
**Commit:** `Wave 1 Agent 1A: management API`

### Agent 1B: Views & lists API
**Type:** `backend-developer` · **Scope:** `src/backend/routes/views.py`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Teams list / team detail | `/api/teams/{id}/page` — champion, domains, per-domain current tasks/artifacts + story, reports, action items, **all-team gutter** (domain_id null) | |
| 2 | Domain detail | `/api/domains/{id}/page` — current tasks/artifacts + full history | |
| 3 | Task list + detail | `/api/tasks` (filterable—see 1D) + `/api/tasks/{id}` (incl. week-by-week history) | |
| 4 | Artifact list + detail | `/api/artifacts` + `/api/artifacts/{id}` (summary + data + change history, for modal) | |
**Commit:** `Wave 1 Agent 1B: views/lists API`

### Agent 1C: Report engine + LLM drafting
**Type:** `python-pro` · **Scope:** `src/backend/reports/` + `src/backend/routes/reports.py` + implement `src/backend/llm/` (consume 0.3 interface)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Draft endpoint | `POST /api/reports/draft` — raw notes → structured report via LLM adapter (stub-safe) | the ONLY create path |
| 2 | Confirm/save (fan-out) | `POST /api/reports` — write report row + upsert task/artifact current state + append history rows + action items, one transaction | match entity by name within domain |
| 3 | Edit + replay | `PATCH /api/reports/{id}` — delete this report's history rows, re-apply, recompute touched current-state by replaying that champion's reports in date order | §4 "updating" |
| 4 | LLM adapter impl | thin pluggable client to the air-gapped endpoint; clear "not configured" path | |
**Commit:** `Wave 1 Agent 1C: report engine + LLM drafting`

### Agent 1D: Search module (copied DSL, adapted)
**Type:** `python-pro` · **Scope:** `src/backend/search/` + `src/backend/routes/search.py`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Adapt parser/compiler | the copied DSL → **SQLite** dialect; keys: `team, domain, type, tag, status, date` | independent module, no soccer refs |
| 2 | Wire to tasks & artifacts | compile filters into the list queries (1B's endpoints accept a `q` DSL string) | coordinate via the `q` param contract in 0.3 |
| 3 | Autocomplete endpoints | `GET /api/search/values?key=...` → enum/numeric/date shapes from our tables | |
**Commit:** `Wave 1 Agent 1D: search DSL (independent, SQLite)`

### After Wave 1
- Cherry-pick 1A–1D onto `mvp-spec`. Orchestrator confirms `app.py` includes all four routers (paths pre-wired in 0.1).
- Verify: backend boots (`uvicorn`), `/docs` lists all endpoints, a hand-POSTed report fans out and reads back on the views endpoints.

---

## Wave 2 — LLM integration & report fixes (3 agents, parallel)

Corrective wave fixing gaps surfaced in review. 2A (`llm/`), 2B (`reports/`), 2C (`management.py` + `search/`) own disjoint files → safe in parallel.

### Agent 2A: LLM endpoint adapter
**Type:** `ai-engineer` · **Scope:** `src/backend/llm/` + `.env` / `.gitignore`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Provider-agnostic client | a real client supporting **both OpenAI and Anthropic**; a config value selects the provider | both must work — no fabricated "always not-configured" stub |
| 2 | Config + secrets | endpoint **URL** + **API key** read from `.env` (two entries, air-gap-supplied); provider switch in config; **add `.env` to `.gitignore` immediately** | secrets never committed |
| 3 | Wire `draft_report` | replace the placeholder with the real provider call; returns a `ReportDocument`-shaped dict; genuine "not configured" **only when URL/key truly unset** | 503 only when unset, not always |
| 4 | Test path | allow supplying a real key (e.g. OpenAI) via `.env` to exercise the live drafting path in tests | Omer may supply a key later |
**Commit:** `Wave 2 Agent 2A: LLM adapter (OpenAI + Anthropic, .env config)`

### Agent 2B: Report engine corrections
**Type:** `python-pro` · **Scope:** `src/backend/reports/engine.py`, `report_schema.json`, `models.py`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | First meeting = first report | remove the "needs an external pre-seed report" assumption — the first meeting is just the team's first report (artifacts entered as `added`; `team.cc_baseline` holds the raw starting point), per the generic report-JSON design (spec §4) | already settled in the JSON design |
| 2 | `started_on` derivation | a task's `started_on` is the earliest report `meeting_date` that mentions it (incl. the first meeting); verify against spec §4/§6 | closes the §6 date concern |
| 3 | User-supplied finish date | **never auto-compute `ended_on`** — remove the trailing-terminal-run guess. The finish date comes from the report: default to the report's `meeting_date`, with an optional per-task override field on the report line (add it to `report_schema.json` + `models.py`) | Omer's rule: "the date I supply" |
| 4 | Edits update **all** reflected fields | editing a report (even minutes after writing it) must recompute every field it touched — including **domain** description/scope/priority — not only tasks/artifacts; replay must reset a domain field when an edit removes/changes it (keep a domain-field baseline or history) | Omer: a fix 40 min later must reflect |
**Commit:** `Wave 2 Agent 2B: report engine corrections (first-meeting, finish date, full edit-replay)`

### Agent 2C: Backend fixes
**Type:** `backend-developer` · **Scope:** `src/backend/routes/management.py`, `src/backend/search/compiler.py`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Bad reference → clean error | creating/patching a champion or domain pointing at a non-existent parent currently raises an unhandled 500; validate the parent exists and return a clear 4xx ("no such team/champion") | from review (was deferred) |
| 2 | Search wildcard safety | escape `%` and `_` in `team`/`domain` name matching so names containing them match literally, not as SQL `LIKE` wildcards | from review (was deferred) |
**Commit:** `Wave 2 Agent 2C: backend fixes (bad-reference 4xx, search wildcard escape)`

### After Wave 2
- Cherry-pick 2A, 2B, 2C. Verify: with `.env` unset, draft → "not configured"; with a key set, draft returns a structured report; the first meeting fans out correctly; editing a report updates domain fields too; bad references return a clean 4xx.

---

## Wave 3 — Frontend (4 agents, parallel; consume Wave-1 API)

### Agent 3A: Management UI
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/manage/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Lists | Teams / Champions / Domains as lists with Add/Edit | |
| 2 | Isolated edit form | Edit opens **one clean modal form**, nothing else around | spec §7 fix |
**Commit:** `Wave 3 Agent 3A: management UI`

### Agent 3B: Team & Domain pages
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/team/*`, `src/frontend/src/pages/domain/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Team page | champion portfolio: domains + current + week-by-week story + reports + action items; **All-team gutter** for un-domained artifacts; "Create report" → report flow | named by team |
| 2 | Domain page | current tasks/artifacts + full story | |
| 3 | Artifact modal usage | clicking an artifact opens `ArtifactDetailModal` (no navigation) | reuse 0.5 component |
**Commit:** `Wave 3 Agent 3B: team & domain pages`

### Agent 3C: Report flow UI
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/report/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Create (notes→draft) | paste raw notes → "Draft with model" → calls `/reports/draft` | no from-scratch form |
| 2 | Preview → confirm | render drafted structured report, "not saved" banner, Confirm/Discard | |
| 3 | Edit saved report | form bound to structured fields (not notes) → PATCH | |
| 4 | `@`/`#` mentions | in the report editor, `@` fuzzy-finds **any** existing task and `#` **any** existing artifact (Jira-style, all of them, not domain-scoped); pick an existing one or type a new name (new ones created from the note). Reuses `GET /api/tasks` + `/api/artifacts`; fuzzy filtering client-side — no new backend | Omer's design |
**Commit:** `Wave 3 Agent 3C: report flow UI`

### Agent 3D: Artifacts, Tasks & Search bar
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/artifacts/*`, `src/frontend/src/pages/tasks/*`, `src/frontend/src/search/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Adapt chip search bar | wrap the copied `filter-builder.js` into a React `SearchBar` (keys team/domain/type/tag/status/date; autocomplete via `/search/values`; URL round-trip) | replaces dropdown + pills |
| 2 | Artifacts page | list filtered by SearchBar; rows open `ArtifactDetailModal` | |
| 3 | Tasks page | list filtered by SearchBar; rows expand to week-by-week journey | |
**Commit:** `Wave 3 Agent 3D: artifacts/tasks + search bar`

### After Wave 3
- Cherry-pick 3A–3D. Verify: `npm run build` clean; every route renders against the live backend; no dead nav.

---

## Wave 4 — Integration & seed (1 agent + orchestrator)

### Agent 4A: Seed + smoke
**Type:** `test-automator` · **Scope:** `src/backend/seed.py`, `scripts/`, `README.md`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Seed script | load the spec's canonical sample (Radar/Dana, Platform/Eli, the signal-processing tasks/artifacts/history) by calling the report engine, so seed exercises the real path | |
| 2 | Run + README | one command to run backend+frontend; README with the model-endpoint env var | |
| 3 | Smoke pass | create report → appears on team/domain/tasks/artifacts; search filters; modal opens; edit+replay correct | report results, don't mask failures |
**Commit:** `Wave 4 Agent 4A: seed + smoke + docs`

### After Wave 4
- Orchestrator runs the app end-to-end, walks the spec's flows, and confirms the SoccerSmartBet tree is untouched (`git -C ~/code/home/SoccerSmartBet status` clean / no references in our code).

---

## Wave 5 — Decisions sign-off (gate)

A final gate so no decision rots in `specs/decisions.md`. Contents are **TBD** — whatever is still open when the build reaches this point.

### Gate: resolve open decisions
**Owner:** orchestrator + Omer
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Close every open item | walk `specs/decisions.md`; confirm each item is either accepted by Omer or completed as a task — **nothing left TBD**; any still-open item becomes a task here and is resolved before the project is called done | no silent defers |

### Live LLM check: report extraction from notes (real OpenAI API)
**Owner:** orchestrator + Omer · **Scope:** `.env` (OpenAI config) + manual run — no code change expected
| # | Task | Target | Notes |
|---|------|--------|-------|
| 2 | Real-model draft test | configure `.env` for the OpenAI wire format (provider/endpoint/key/model), then run **1–2** report drafts from raw notes on the Create Report screen and confirm the model returns a sensible, schema-valid structured report | the one path that can't be tested offline; needs internet; one clean note + optionally one messy = enough for MVP. Everything else (UI, save, fan-out, search, edit/replay) already live-verified end-to-end |

### After Wave 5
- `specs/decisions.md` has zero open items, and the real-model draft test has passed. Project done.
