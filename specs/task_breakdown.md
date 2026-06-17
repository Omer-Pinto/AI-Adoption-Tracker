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
| 0.5a | Scaffold | Vite+React+TS; `AppShell` (sidebar Teams→`/`, Artifacts→`/artifacts`, Tasks→`/tasks`) reusing the `mvp/` look; router with **all routes → stub pages** at fixed paths | no router edits in Wave 2 |
| 0.5b | Primitives | `api.ts` client (stub to the api_contract shape); `Modal`, `DataTable`, `Badge`, working `ArtifactDetailModal` | shared by 2B & 2D |
**Commit:** `Wave 0 Agent 0B: frontend foundation`

### 0.4 — Copy search source (orchestrator `cp` — read-only safety)
Orchestrator copies the SoccerSmartBet search files into this repo as the adaptation base: parser/compiler/autocomplete → `src/backend/search/`; `filter-builder.js` → `src/frontend/src/search/`. **Pure copy** — strip soccer-specific imports; never edit or reference the source tree. (Adaptation happens in 1D / 2D.)

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

## Wave 2 — Frontend (4 agents, parallel; consume Wave-1 API)

### Agent 2A: Management UI
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/manage/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Lists | Teams / Champions / Domains as lists with Add/Edit | |
| 2 | Isolated edit form | Edit opens **one clean modal form**, nothing else around | spec §7 fix |
**Commit:** `Wave 2 Agent 2A: management UI`

### Agent 2B: Team & Domain pages
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/team/*`, `src/frontend/src/pages/domain/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Team page | champion portfolio: domains + current + week-by-week story + reports + action items; **All-team gutter** for un-domained artifacts; "Create report" → report flow | named by team |
| 2 | Domain page | current tasks/artifacts + full story | |
| 3 | Artifact modal usage | clicking an artifact opens `ArtifactDetailModal` (no navigation) | reuse 0.5 component |
**Commit:** `Wave 2 Agent 2B: team & domain pages`

### Agent 2C: Report flow UI
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/report/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Create (notes→draft) | paste raw notes → "Draft with model" → calls `/reports/draft` | no from-scratch form |
| 2 | Preview → confirm | render drafted structured report, "not saved" banner, Confirm/Discard | |
| 3 | Edit saved report | form bound to structured fields (not notes) → PATCH | |
**Commit:** `Wave 2 Agent 2C: report flow UI`

### Agent 2D: Artifacts, Tasks & Search bar
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/artifacts/*`, `src/frontend/src/pages/tasks/*`, `src/frontend/src/search/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Adapt chip search bar | wrap the copied `filter-builder.js` into a React `SearchBar` (keys team/domain/type/tag/status/date; autocomplete via `/search/values`; URL round-trip) | replaces dropdown + pills |
| 2 | Artifacts page | list filtered by SearchBar; rows open `ArtifactDetailModal` | |
| 3 | Tasks page | list filtered by SearchBar; rows expand to week-by-week journey | |
**Commit:** `Wave 2 Agent 2D: artifacts/tasks + search bar`

### After Wave 2
- Cherry-pick 2A–2D. Verify: `npm run build` clean; every route renders against the live backend; no dead nav.

---

## Wave 3 — Integration & seed (1 agent + orchestrator)

### Agent 3A: Seed + smoke
**Type:** `test-automator` · **Scope:** `src/backend/seed.py`, `scripts/`, `README.md`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Seed script | load the spec's canonical sample (Radar/Dana, Platform/Eli, the signal-processing tasks/artifacts/history) by calling the report engine, so seed exercises the real path | |
| 2 | Run + README | one command to run backend+frontend; README with the model-endpoint env var | |
| 3 | Smoke pass | create report → appears on team/domain/tasks/artifacts; search filters; modal opens; edit+replay correct | report results, don't mask failures |
**Commit:** `Wave 3 Agent 3A: seed + smoke + docs`

### After Wave 3
- Orchestrator runs the app end-to-end, walks the spec's flows, and confirms the SoccerSmartBet tree is untouched (`git -C ~/code/home/SoccerSmartBet status` clean / no references in our code).
