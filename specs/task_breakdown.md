# AI Adoption Tracker — Task Breakdown

> **Created:** 2026-06-17 | **Status:** Draft | **Branch:** `mvp-spec`
> **Spec:** `specs/spec.md` (authoritative). `mvp/` HTML = visual reference only.
> **Execution:** **Opus** expert agents (per user — never Sonnet). The orchestrator (main session) **never writes code** — it only plans, dispatches agents, verifies, and cherry-picks. **Every** build task — sequential Wave-0 setup and integration fixes included — is done by an expert agent. The sole orchestrator hands-on action is the `cp` in 0.4, to guarantee the SoccerSmartBet read-only boundary.

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

---

## Wave 5.5 — Stabilization (bugs + edit/save UX before extraction depth)

Corrective wave from a full live walkaround + backend sweep + targeted reproduction. The app *runs* (every screen renders; all 25 endpoints respond, no 500s) but it is not yet trustworthy to operate. This wave fixes the **reproduced** defects so later waves build on a stable base. Each item below was reproduced live — not assumed. 5.5A (`src/backend/` routes/engine/schema), 5.5B (`src/backend/llm/interface.py`), and 5.5C (`src/frontend/`) own disjoint trees → safe in parallel.

> **Reproduction evidence (do not re-litigate):** (#2 save) `POST /api/reports` with a new artifact lacking `type` → **HTTP 422 "artifact 'X' is new but has no type"**; (#3 edit) the report **edit page** edits & persists everything (action-item edit confirmed in DB), but the **preview** only inline-edits tasks/artifacts — action items / discussion / issues are read-only there; (#4 mentions) `@`/`#` live search **works** (verified `@clu`→Clutter map, `#clu`→clutter-review) — **no fix needed**; (#5) domain ordering puts NULL-priority first, duplicate `(champion, meeting_date)` is accepted, cross-team champion assignment is accepted.

> **Forward note (Omer):** post-5.5 the team expects to move from waves to issue-based **tasks / bugs / features**; the remaining waves may be the last. 5.5B partially overlaps Wave 8 §8A (extraction) — it adds only the *safety-net* (nothing dropped, artifacts always typed); when Wave 8 runs, fold 5.5B into 8A rather than duplicating.

### Agent 5.5A: Backend correctness fixes
**Type:** `backend-developer` · **Scope:** `src/backend/routes/views.py`, `src/backend/routes/management.py`, `src/backend/routes/reports.py`, `src/backend/reports/engine.py`, `src/backend/schema.sql`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Domain ordering: NULL priority **last** | team-page + domain queries `ORDER BY priority IS NULL, priority, id` (or CASE) so a set priority sorts above unprioritized | reproduced: NULL floats to top, buries priority-1 |
| 2 | Reject duplicate report date | `POST /api/reports`: a second report for the same `(champion_id, meeting_date)` → **422** (engine guard + `UNIQUE(champion_id, meeting_date)` in schema) | reproduced: dup accepted → replay corrupts history |
| 3 | Cross-team champion → 422 | `POST`/`PATCH /api/domains`: reject when `champion.team_id != domain.team_id` with a clear 4xx | reproduced: orphan domain in no portfolio |
| 4 | Surface fan-out validation errors | the typeless-artifact 422 (and siblings) must return a structured, UI-consumable error body | pairs with 5.5C #2 |
| 5 | Typed `response_model` on report endpoints | `POST`/`GET`/`PATCH /api/reports` use the `Report` model so OpenAPI isn't `any` | minor; contract hygiene |
| 6 | Auto-create domains from the report | the first report that names a domain introduces it — fan-out + replay create the domain (name + any `changes`: scope/priority/description) instead of 422'ing; same model as tasks/artifacts. No manual domain pre-definition | Omer: "the domain is covered in the first report — I don't want to define it manually" |
**Commit:** `Wave 5.5 Agent 5.5A: backend fixes (ordering, dup-date, cross-team, typed reports, auto-create domains)`

### Agent 5.5B: LLM extraction safety-net
**Type:** `ai-engineer` · **Scope:** `src/backend/llm/interface.py` (`_SYSTEM_PROMPT` only)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | No note line dropped | prompt rule: every line of the notes must land somewhere — if it can't be placed in a structured field, it goes to `discussion`/`issues` (and `raw_notes` always verbatim). NO item silently ignored | reproduced: messy notes dropped categories |
| 2 | New artifacts always typed | prompt must assign a `type` (agent/skill/hook/context) to every new artifact; if genuinely unknown, pick the best-fit and note uncertainty — never emit a typeless new artifact | removes the #2 save-blocker at the source |
**Commit:** `Wave 5.5 Agent 5.5B: extraction safety-net (no-drop + always-typed artifacts)`

### Agent 5.5C: Report-flow + manage UX fixes
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/report/ReportPreviewPage.tsx`, `ReportEditPage.tsx`, `src/frontend/src/pages/manage/*`, plus edit-affordance links on `pages/tasks/*` / `pages/artifacts/*` / `pages/team/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Preview parity | make **action items, discussion, issues editable in the preview** (create flow), matching the edit page — not just tasks/artifacts | the real "can't edit action items" |
| 2 | Require type + surface save errors | block save when a new artifact has no `type` (inline error); show the backend 422 message instead of a silent failure | pairs with 5.5A #4 |
| 3 | Edit discoverability | clear affordance/link to the owning report's edit page from task / artifact / action-item context (rows or detail) | editing works; it just isn't findable |
| 4 | CC Baseline as textarea | team add/edit form: CC Baseline is a multi-line **textarea** (multiple sentences), not a short single-line textbox | Omer request |
**Commit:** `Wave 5.5 Agent 5.5C: report-flow preview parity + save errors + discoverability + CC textarea`

### Agent 5.5D: Navigation & preview clarity (frontend)
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/components/AppShell.tsx`, `src/frontend/src/pages/report/ReportPreviewPage.tsx`, `ReportEditPage.tsx`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Sidebar "＋ New Report" | top of Main nav → `/reports/new` (champion dropdown on the page) | Manage-only users had no report entry point |
| 2 | Label domain sections clearly | preview/edit: render each block as "Domain: X" so it's obvious artifacts/tasks are grouped *under a domain* | reproduced confusion: artifacts appeared under a bare "Claude Code" header |
| 3 | Render team-wide artifacts section | preview/edit show the top-level (un-domained) artifacts from 5.5E as their own "Team-wide artifacts" block | depends on 5.5E |
**Commit:** `Wave 5.5 Agent 5.5D: sidebar New Report + preview domain/team-wide clarity`

### Agent 5.5E: Domain semantics + team-wide artifacts (backend + prompt)
**Type:** `ai-engineer` · **Scope:** `src/backend/models.py`, `src/backend/report_schema.json`, `src/backend/reports/engine.py`, `src/backend/llm/interface.py` (`_SYSTEM_PROMPT`)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Team-wide artifacts slot in the report | add top-level `artifacts: list[ReportArtifactEntry]` to `ReportDocument` (models + `report_schema.json`); fan-out + replay create/update them as `artifact` rows with `domain_id NULL` (the all-team gutter) | DB + views already support domain-null artifacts |
| 2 | Prompt: domains are tech stacks only | `_SYSTEM_PROMPT`: never invent a domain from "Claude Code"/headings/adoption-meta; use only real team tech/stack domains; CC-adoption artifacts that fit no tech domain go in the top-level team-wide artifacts list | a domain = a team technology/stack area only |
| 3 | Prompt: group, don't explode | one described thing = one artifact (e.g. "context md files in a router pattern (architecture, conventions, index, deep-dives)" → ONE `context` artifact, not four); only concrete named tools/skills/agents/hooks/context become artifacts | reproduced: 4 artifacts from one md-file description |
**Commit:** `Wave 5.5 Agent 5.5E: domains=tech-stacks-only + team-wide artifacts slot + artifact grouping`

### Agent 5.5F: Context-driven assignment + General domain + domain picker
**Type:** `ai-engineer` · **Scope:** `src/backend/llm/interface.py`, `src/backend/reports/engine.py`, `src/frontend/src/pages/report/*`, `src/frontend/src/api.ts`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Prompt: use ONLY provided (existing) domains; assign each task/artifact to its best-fit existing domain; **"General"** catch-all when unsure; never invent a domain | `llm/interface.py` `_SYSTEM_PROMPT` | |
| 2 | Prompt: existing-vs-new — reference the matching existing task/artifact by exact name unless notes say "new …"; match on meaning | `llm/interface.py` | |
| 3 | Per-champion **"General"** catch-all domain, ensured at draft + offered in context/UI | `reports/engine.py` `_ensure_general_domain` + `build_draft_context` | |
| 4 | UI **domain picker** per task/artifact (preview + edit) — moves item between the champion's domains; "Domain: X" labels | `pages/report/*`, `api.ts` `domains.listByChampion` | |
**Commit:** `Wave 5.5 Agent 5.5F: context-driven domain assignment + General catch-all + per-item domain picker`

### Agent 5.5G: Domain setup redesign — text→domains extraction + symmetric links
**Type:** `ai-engineer` · **Scope:** `src/backend/llm/interface.py`, `src/backend/routes/management.py`, `src/backend/schema.sql`, `src/backend/models.py`, `src/backend/report_schema.json`, `src/backend/reports/engine.py`, `src/backend/domain_helpers.py`, `src/frontend/src/pages/manage/*`, `src/frontend/src/pages/domain/*`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | `POST /api/domains/extract` — text → `{domains:[{name, description, priority}]}` proposals (not saved); new `extract_domains()` + `DomainExtraction`/`DomainProposal` (OpenAI/Anthropic SDK + Pydantic) | `llm/interface.py`, `routes/management.py` | |
| 2 | Remove `scope` everywhere; `priority` → free TEXT | `schema.sql`, `models.py`, `report_schema.json`, `reports/engine.py`, `routes/*`, frontend | |
| 3 | `cross_domain` → symmetric `domain_link` table; domain → multi-select of domains across ALL teams ("Team: Domain"); add/remove propagate both ways; `Domain` returns `team_name` + `cross_domains[]` | `schema.sql`, `models.py`, `routes/management.py`, `domain_helpers.py` | |
| 4 | Shared `DomainForm` for edit-existing AND approve-extracted; "Set up domains" flow (pick team → champion auto when sole → paste text → extract → approve each) | `pages/manage/DomainForm.tsx`, `pages/domain/DomainSetupPage.tsx` | |
| 5 | CC Baseline relabeled "Current Claude Code status" + real placeholder | `pages/manage/TeamForm.tsx` | |
**Commit:** `Domain redesign: text->domains LLM extraction, symmetric cross-links, drop scope` (b336eaf)

### After Wave 5.5
- Cherry-pick 5.5A–5.5G. Verify by re-running the reproductions: dup-date → 422; cross-team → 422; domains sort with NULL last; a draft with a new artifact saves (typed) and, if forced typeless, the UI blocks with a clear message; action items/discussion/issues editable in preview; CC Baseline is a textarea; `@`/`#` still work; **a draft no longer invents a "Claude Code" domain** — CC-adoption artifacts land in the team-wide list, grouped (md files → one context artifact); sidebar New Report works. Re-seed clean and walk the create→preview→edit→save loop end to end.

---

## Wave 6 — Domain-add UX design (1 agent — spec only)

The Manage → domains tab shows TWO confusing buttons — **"Set up domains"** (grey/secondary, opens a SEPARATE PAGE `/domains/setup`) and **"+ Add Domain"** (purple/primary, opens a MODAL for one domain): different colors, duplicated-seeming purpose, and inconsistent surfaces (add team/champion/single-domain are modals, multi-domain is a separate page). This wave produces **only the UX design spec** — no code. Implementation is **Wave 7** (a separate wave), because agents within a wave run in parallel: the build must wait for the approved spec, so it cannot share a wave with the design.

### Agent 6A: Domain-add UX design (spec only, no code)
**Type:** `ux-researcher` · **Scope:** `specs/domain_add_ux.md` (design spec only — no app code)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Consolidate to ONE "Add Domain(s)" affordance | spec the single entry point that replaces the two buttons | one button, one purpose |
| 2 | Two flavours in one surface | (a) manual single-domain insert (rare), (b) multi-domain LLM extraction (paste text → propose → approve) | both reachable from the one button |
| 3 | Decide the surface once and justify | modal vs page, applied uniformly to match add-team / add-champion / edit; lay out the flow + states; call out retiring/folding `/domains/setup` | the UX expert's call — pick one, don't leave it open |
**Commit:** `Wave 6 Agent 6A: domain-add UX design spec`

### After Wave 6
- Cherry-pick 6A's spec. **Omer approves it before Wave 7 implements** — the spec is the gate.

---

## Wave 7 — Domain-add implementation (1 agent; consumes Wave 6's approved spec)

Builds exactly what the approved `specs/domain_add_ux.md` defines: **two clearly-labelled buttons** on the Domains tab — **"+ Add Domain"** (manual single domain → the existing `DomainForm` **modal**) and **"Smart domain extract"** (the LLM multi-domain flow → a **page**). Single agent, run after the spec is approved (done).

### Agent 7A: Two-button domain-add (manual modal + smart-extract page)
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/manage/*`, `src/frontend/src/pages/domain/DomainSetupPage.tsx`, `src/frontend/src/router.tsx`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Two labelled buttons; drop the old grey "Set up domains" link | `pages/manage/ManagePage.tsx` | "+ Add Domain" (primary) → manual modal; "Smart domain extract" → extract page |
| 2 | Manual modal: block Save until Name non-empty (inline "Name is required"); Priority → **numeric** input (1,2,3…) | `pages/manage/DomainForm.tsx` | empty-name guard absent today; priority was free-text |
| 3 | Smart-extract **page** (re-entered from the new button): one champion per batch; **warn before re-Extract** discards unsaved edited proposals (5B); close = leave, no warning (6A); add "No domains found…" empty state | `pages/domain/DomainSetupPage.tsx`, `router.tsx` | keep page surface (per verdict); relabel entry; no `/domains/setup` redirect |
| 4 | Domains list sorted by **numeric priority, nulls last** | `pages/manage/ManagePage.tsx` | backend `priority` stays TEXT-backed; sort numerically client-side |
**Commit:** `Wave 7 Agent 7A: two-button domain-add (manual modal + smart-extract page)`

### After Wave 7
- Cherry-pick 7A. Verify live: two labelled buttons ("+ Add Domain", "Smart domain extract"); manual add is a modal that blocks an empty name and takes a numeric priority; Smart extract opens the page, binds a batch to one champion, warns on re-Extract with unsaved edits, closes without warning; the old grey "Set up domains" link is gone; the domains list is ordered by priority number.

---

## Wave 8 — Report schema + mining prompt + both-provider structured output (1 agent + 2 gates)

**This is the contract everything downstream depends on, so it is its own wave.** Simplify the report and make it mine raw notes: the report references **existing domains only** (drops domain creation + the per-domain `changes` priority/description — domains are owned by the Smart-extract flow); the prompt **mines** every supported `ReportDocument` category (single-shot); per-entity matching returns `{id, name}` when a mention matches an existing entity, else `{name, type (artifacts), …suggested fields}`; structured output for **both** providers, each its own form. Two Omer-authorization gates close the wave. **No automated test — Omer tests live.** Single build agent on `llm/`+`models.py`+`report_schema.json`; the engine that consumes this is the next wave (it edits a different file, `reports/engine.py`).

> **Read first:** `src/backend/llm/interface.py` (`_SYSTEM_PROMPT`, `_user_content`, both provider paths, `extract_domains` / `draft_report`), `src/backend/models.py` (`ReportDocument`), `src/backend/report_schema.json`.

> **Entity-matching contract (Omer's design):** the context (built in Wave 9) passes ONLY the **team's** tasks & artifacts, each as key-value JSON **+ id**. Match → return `id` + name (artifacts also `type`); no match → return the free text identified as the task/artifact + name (artifacts: + `type`) + any other suggested fields. IDs are globally unique across teams (existing integer PKs) and serve as the link/match id.

### Agent 8A: Simplify schema + rewrite mining prompt + both-provider structured output
**Type:** `ai-engineer` · **Scope:** `src/backend/llm/interface.py`, `src/backend/models.py`, `src/backend/report_schema.json`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Simplify the report | existing domains only (+ "General"); remove domain creation + the per-domain `changes` (priority/description) | Q-A; reverses 5.5A#6 |
| 2 | Rewrite `_SYSTEM_PROMPT` to MINE, not transcribe | fill every `ReportDocument` category the notes support; free-text inference; keep champion / meeting_date / verbatim raw_notes | single-shot; never fabricate, never drop |
| 3 | Per-entity matching contract | `{id, name}` if matched else `{name, type (artifacts), …suggested fields}`; explicit "new …" stays new | per the contract above |
| 4 | Structured output for BOTH providers | OpenAI `response_format` (strict) + Anthropic forced-tool `input_schema`, same Pydantic model, validated | mirror `extract_domains` |
**Commit:** `Wave 8 Agent 8A: simplify report schema + mining prompt + both-provider structured output`

### Wave 8 gates — Omer authorization (orchestrator-run; not parallel agents)
| # | Gate | Owner | Notes |
|---|------|-------|-------|
| G1 | **Omer reviews & approves the rewritten prompt + simplified `ReportDocument` schema** (verbatim) before Wave 9 starts | Omer + orchestrator | like the domains review |
| G2 | **Both-provider structured-output audit** — `ai-engineer` confirms OpenAI + Anthropic structured outputs each implemented correctly (its own form) + validated; Omer signs off | Omer + `ai-engineer` | same audit as domain extraction |

### After Wave 8
- 8A cherry-picked; **G1 + G2 passed.** The prompt + simplified schema are frozen — Wave 9 builds the engine against them.

---

## Wave 9 — Report engine: team-scoped context + id-based save (1 agent)

Builds the engine against Wave 8's **approved** schema/prompt. **One agent** — it owns `reports/engine.py` (both the draft-context and the save path), so it cannot be split into parallel agents on the same file.

### Agent 9A: Team-scoped context + id-based save + new-in-preview
**Type:** `python-pro` · **Scope:** `src/backend/reports/engine.py`, `src/backend/routes/reports.py`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Team-scoped context | `build_draft_context` passes ONLY the team's tasks & artifacts (full fields + id), scoped to the report's **team** | single-shot; no live lookup tool |
| 2 | Trim domain baggage from context | existing domain names only (for placement) | aligns with the simplified schema |
| 3 | Matched entry → resolve by `id` | a returned `id` saves to that exact existing row (no fuzzy, no duplicate) | ids globally-unique PKs |
| 4 | New/unmarked entry → surface as NEW in preview | per Q2: shown as a new task/artifact for Omer to accept/edit/reject; created on confirm | not auto-created silently |
**Commit:** `Wave 9 Agent 9A: team-scoped context + id-based save + new-in-preview`

### After Wave 9
- A raw note drafts a rich report referencing existing domains, matching the team's tasks/artifacts by `id` (no duplicates), and proposing new ones as NEW in the preview. Omer validates live — no automated test.

---

## Wave 10 — Report editor: JIRA-style links + team-scoped @/# mentions + NEW markers (1 agent)

Consumes Wave 9's id-returning draft. Matched mentions render as JIRA-style linked chips; new ones as a "new"-flagged variant of the same chip; `@`/`#` opens a team-scoped picker that links by id.

### Agent 10A: JIRA-style entity links + team-scoped mention picker + NEW markers
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/report/*`, `src/frontend/src/api.ts`
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Matched entries (with `id`) → JIRA-style linked chips | preview + edit; click → the entity | depends on Wave 9 id output |
| 2 | `@`/`#` opens a **team-scoped** list of tasks/artifacts; select links by id | reworks the Wave-3C global mentions | team scope, not all-teams |
| 3 | Mark **NEW** (unmatched) tasks/artifacts with a clear "NEW" label/badge | preview + edit; visually distinct from the matched linked chips (new = no `id`) | exact visual is the frontend agent's call — badge / label / grouped "new" list |
**Commit:** `Wave 10 Agent 10A: JIRA-style entity links + team-scoped @/# mentions + NEW markers`

### After Wave 10
- Matched entities show as linked chips, new ones as NEW-flagged, and `@`/`#` lists the team's tasks/artifacts and links by id.

---

## Wave 11 — Frozen Contract, branch & AI-Lead design (gate — orchestrator + Omer; NO build code)

> **Wave mechanics (Omer's correction):** a wave = agents that ALL run **fully parallel and independent**; ANY dependency → a **separate consecutive wave**. So the shared **contract sits in its own wave**, and within an agent one expert does its tasks sequentially. The dependency chain here is: shared contract → backend + FE-foundation build it in code → FE consumers branch off that. That is **4 waves**: **11** (contract/branch/design, no code), **12** (backend core + backend routes + FE-foundation/report-editor — parallel, each writes the contract into code on disjoint trees), **13** (FE consumers — manage, viewers, AI-Lead — parallel, each branches off Wave-12 so they share the contract, not each other), **14** (search). All Wave-11→14 work lives on **`mvp-improvements`** (off `mvp-spec`).

### 11.1 — Branch & DB (orchestrator)
| # | Task | Notes |
|---|------|-------|
| 1 | Commit these spec updates to `mvp-spec`, then create **`mvp-improvements` off `mvp-spec`** — base for all Wave 11→14 work | `mvp-spec` stays intact as the revert point; new branch is the road to v1.0 |
| 2 | Delete local `src/backend/tracker.db` ("leave no old db"; regenerates from `schema.sql` on boot) | **Omer-authorized** (item 2): QA-only playground DB, not operational. Leave `tracker.db.bak`. One-time override of the never-wipe rule, this DB only |

### 11.2 — FROZEN CONTRACT (orchestrator publishes; every Wave 12–13 agent obeys verbatim)
1. **CC Baseline removed (item 2):** drop `team.cc_baseline` **and** `team.baseline_date` (paired capture date — meaningless alone). Gone from: `schema.sql`, `models.Team`, `TeamCreate`/`TeamUpdate`, `seed._create_team`, frontend `types.Team`, `TeamForm`. No replacement. (Leave the defensive `_SYSTEM_PROMPT` "Current Claude Code status is never a domain" line.)
2. **Task due date (item 7):** rename the task finish field → **`due_date`**, with **free user-supplied date semantics like action items** — **pickable on ANY task incl. a brand-new one**, NOT gated by terminal status. DB `task.ended_on`/`task_history.ended_on`→`due_date`; `Task`/`TaskHistory`/`ReportTaskEntry.finished_on`→`due_date`; engine drops the terminal-status gate on the date; `TaskPatch.ended_on`→`due_date`; `search/service.py`+`compiler.py` `t.ended_on`→`t.due_date`; `seed` `finished_on=`→`due_date=`; frontend `ReportTaskLine.finished_on`→`due_date`, editor header **"Finished on"→"Due on"**.
3. **`wont_fix` status (item 8):** add status token **`wont_fix`** (label **"Won't Fix"**), **terminal/closed**. `TaskStatus` enum + both task `CHECK`s + `_TERMINAL_STATUSES` (add `wont_fix`). Full set now: `planned, in-progress, finished_successfully, finished_with_issues, blocked, abandoned, wont_fix`.
4. **Action-item status (item 8):** add `action_item.status` (`CHECK` = the full set incl `wont_fix`, **default `planned`**) and **drop the `resolved` column** (DB wiped → no migration). `ActionItem.resolved`→`ActionItem.status`; add `ReportActionItem.status` (default `planned`); engine `_insert_action_item` writes status; `_action_item` mapper + team-page counts use status (open = status ∉ terminal).
5. **Owner (item 4):** literal AI-Lead string = exactly **`"AI Lead"`** (item-10 filter depends on it). Task owner **defaults to the champion's actual name** (engine fills when entry owner empty; prompt also says so). Report-editor owner cell = **dropdown `{AI Lead, <champion name>, other}`**, "other"→free text; champion name threaded into `TasksCard`/`ActionItemsCard`. LLM **declares each action-item owner ∈ {champion name, `"AI Lead"`}**. Storage stays free `TEXT` / Pydantic `str` (dynamic champion name can't be a static enum — constrain via prompt + FE dropdown).
6. **Domains constant "Context creation" (item 5):** ensure a per-champion **"Context creation"** domain with **`priority = "1"`**, created + injected into `build_draft_context` exactly like **"General"** (which stays `priority NULL` and remains the *unplaced fallback*). Both always present in the placement context sent to the LLM; "Context creation" participates in placement but is NOT the fallback. So user adds Backend+Frontend → **4 domains total** (those two + General + Context creation).
7. **Team-page counts (item 9):** add to `TeamPage` model + `team_page()`: `open_tasks`, `closed_tasks`, `open_action_items`, `closed_action_items`, `meeting_count`, `domain_count`, `artifact_count` (closed = status ∈ terminal).
8. **Delete endpoints (item 6):** `DELETE /api/champions/{id}` — **blocked with a clear 409 if the champion has ANY reports** (never destroy meeting history); if no reports, delete the champion + its (empty) domains. Clean 4xx, never 500. And `DELETE /api/domains/{id}` (**reassign its tasks/artifacts to the champion's "General" domain, then delete**; **block deleting the "General"/"Context creation" constants** with a clear message). Purpose = tidying unused/misspelled/badly-named domains, not removing active ones.
9. **Cross-team AI-Lead action items (item 10 backend):** `GET /api/ai-lead/action-items` → `[{id, text, team_name, champion_name, meeting_date, status, domain, report_id}]`, filter `action_item.owner = 'AI Lead'`, all teams, newest `meeting_date` first. (Shape may be refined by the item-10 design — additive only.)
10. **FE foundation files owned by Agent 12C only** (`types.ts`, `styles/app.css`, `api.ts`); **Wave-13 agents reference, never edit them** — *one exception:* 13A removes `Team.cc_baseline` from `types.ts` in Wave 13 (12C leaves it so its build stays green). 12C's other type changes are **additive** (new fields, keep old optional) so the whole FE project still compiles in 12C's worktree. New api.ts methods (added by 12C): `champions.delete`, `domains.delete`, `aiLead.actionItems`. CSS tokens (12C): `status-wont_fix`, journey `dot-wont_fix`, detail-timeline `detail-tl-dot dot-wont_fix`, report-editor `sd-wont_fix` (color = muted slate/grey).

### 11.3 — Item-10 design gate (orchestrator + Omer — the one item that needs design)
| # | Task | Notes |
|---|------|-------|
| 1 | Agree the AI-Lead view design | recommend a **dedicated top-level "AI Lead" page + nav** (NOT "AI Lead as a team", which Omer suspects is wrong); MVP = action items owned by `"AI Lead"`, cross-team, showing content / team / meeting date / status; settle any grouping/filter | approving it now lets the build (13C) run in Wave 13 |

### After Wave 11
- Branch `mvp-improvements` exists off `mvp-spec`; old `tracker.db` gone; contract frozen; item-10 design approved. **No code to cherry-pick.**

---

## Wave 12 — Backend core + Backend routes + FE-foundation/report-editor (3 agents, parallel)

> All three build the Wave-11 contract **into code** and own **disjoint trees** (`src/backend/` non-routes / `src/backend/routes/` / `src/frontend/` foundation+report). 12A↔12B follow the proven Wave-1 model (parallel backend agents written to a frozen contract, cherry-picked together; runtime-verified post-merge). 12C is frontend — it compiles standalone against the contract (FE↔BE integration verified post-merge). **After this wave every shared name/enum/route/CSS-token/api-method exists in code**, so Wave-13 consumers depend only on a prior wave, never on each other.

### Agent 12A: Backend core — data model, engine, prompt, seed, search
**Type:** `python-pro` · **Scope:** `src/backend/{schema.sql, models.py, reports/engine.py, llm/interface.py, seed.py, search/service.py, search/compiler.py, search/autocomplete.py, tests/}` (disjoint from 12B's `routes/*`)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Remove cc_baseline + baseline_date | `schema.sql` team table, `models.Team`, `seed._create_team` (sig + INSERT + 2 call sites) | contract #1 |
| 2 | Task `ended_on`/`finished_on` → `due_date`, decouple from terminal gate | schema (task + task_history), models (Task/TaskHistory/ReportTaskEntry), engine (`_record_task_entry`, `_recompute_task_current_state`, `apply_manual_task_edit`, `_TERMINAL_STATUSES` date sites), `search/service.py`+`compiler.py`, `seed.py` | contract #2; most cross-cutting rename |
| 3 | Add `wont_fix` to status set | `TaskStatus` enum + both task `CHECK`s + `_TERMINAL_STATUSES` | contract #3 |
| 4 | Action-item status (drop `resolved`) | `action_item` schema (status CHECK, default planned; remove resolved), `ActionItem.status`, `ReportActionItem.status`, engine `_insert_action_item` | contract #4 |
| 5 | Owner: default champion + LLM-declared action-item owner | engine default-owner-to-champion when empty (`_create_task`/`_record_task_entry`); `_SYSTEM_PROMPT` — task owner defaults champion, action-item owner ∈ {champion, "AI Lead"} | contract #5; `champion_name` already in context |
| 6 | "Context creation" constant domain (priority 1) | engine: `_CONTEXT_DOMAIN_NAME` + `_ensure_context_creation_domain` (sets `priority='1'`), call alongside `_ensure_general_domain` in `build_draft_context`; both in domains context; prompt notes both | contract #6; General stays NULL/fallback |
| 7 | Fix + re-verify tests & seed | update `tests/test_journal_manual_edits.py` for owner/due_date/status; confirm `seed.py` still fans out §6 | run tests in worktree throwaway DB only |
**Commit(s):** `Wave 12 Agent 12A: backend core (drop cc_baseline, due_date, wont_fix + action-item status, owner defaults, Context-creation domain)`
**Gate after 12A:** orchestrator has **ai-engineer review** the `_SYSTEM_PROMPT` + structured-output diff (owner rules, action-item status, domain rules) before relying on it — per "consult experts."

### Agent 12B: Backend routes — management, views, team counts, cross-team endpoint
**Type:** `backend-developer` · **Scope:** `src/backend/routes/{management.py, views.py, reports.py}` (disjoint from 12A)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Drop cc_baseline/baseline_date from request models | `TeamCreate`, `TeamUpdate` (`management.py`) | contract #1 |
| 2 | `DELETE /api/champions/{id}` | `management.py` — **409 if champion has any reports**; else delete champion + empty domains; clean 4xx, never 500 | contract #8 |
| 3 | `DELETE /api/domains/{id}` | `management.py` — reassign tasks/artifacts → champion's "General", then delete; block deleting General/Context-creation | contract #8 |
| 4 | Team-page counts | `TeamPage` model + `team_page()` return: open/closed tasks, open/closed action items, meeting_count, domain_count, artifact_count | contract #7; all derivable from data already loaded |
| 5 | `TaskPatch.ended_on`→`due_date`; `_action_item` status | `views.py` | contracts #2/#4 |
| 6 | `GET /api/ai-lead/action-items` (+ response model) | `views.py` — join action_item→report→champion→team, filter owner='AI Lead', newest first | contract #9; item-10 backend (consumed by 13C) |
**Commit(s):** `Wave 12 Agent 12B: backend routes (cc_baseline removal, champion/domain delete, team counts, due_date/status, AI-Lead cross-team endpoint)`
**Note:** writes against the frozen contract (12A's names); per-agent verify is build-level — runtime verified post-cherry-pick by orchestrator (same as Wave 1).

### Agent 12C: Frontend foundation (types/css/api.ts) + report editor
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/{types.ts, styles/app.css, api.ts, pages/report/*}` (**sole owner of the FE contract files** — establishes everything Wave-13 consumes; compiles standalone against the frozen contract)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | FE type contract (**additive — build must stay green**) | `types.ts` — `TaskStatus` += `'wont_fix'`; **add** `ActionItem.status` (keep `resolved` optional, don't remove); add `ReportActionItemLine.status`; `ReportTaskLine.finished_on`→`due_date` (all its consumers are in `pages/report/*` = 12C's scope). **LEAVE `Team.cc_baseline`** — 13A removes it with the form (removing it here would break `TeamForm.tsx`) | contracts #3–5/#10 |
| 2 | FE css contract | `app.css` — status tokens (`status-wont_fix`/`dot-wont_fix`/`sd-wont_fix`/detail-tl, muted slate); table alignment fix (`.report-editor table.flat td` → `vertical-align: top`); participants css | items 1 + contract #10 |
| 3 | api.ts methods | `api.ts` — `champions.delete`, `domains.delete` (DELETE `/api/champions|domains/{id}`); `aiLead.actionItems` (`GET /api/ai-lead/action-items`) | contracts #8/#9; consumed by 13A/13C |
| 4 | Participants: comma-add + defaults | `reportEditor.tsx` `.participants-row` — commit a pill on `,` (and Enter); default `[champion, "AI Lead"]` pills when empty | item 3 |
| 5 | Owner dropdown | `TasksCard` + `ActionItemsCard` owner cell → `<select>{AI Lead, <champion>, other}`; "other"→free text; thread champion from `FlatReportEditor` | items 3/4 (FE) |
| 6 | "Finished on"→"Due on" | `reportEditor.tsx` `<th>` + field `finished_on`→`due_date` | item 7 (FE) |
| 7 | Action-item status column + Won't Fix option | `ActionItemsCard` Status `<select>` (`STATUS_OPTS`/`StatusControl`) + `stripReportForSave` sanitizer; `STATUS_OPTS`+`statusCls` += Won't Fix | item 8 (FE editor) |
**Commit(s):** `Wave 12 Agent 12C: FE foundation (types/css/api.ts) + report editor (alignment, participants, owner dropdown, Due on, action-item status, Won't Fix)`

### After Wave 12
- Cherry-pick 12A–12C onto `mvp-improvements`. Verify: backend boots + `import app` clean; `npm run build` green; new endpoints in `/docs`; report editor renders with the new columns. The FE contract (`types.ts`/`app.css`/`api.ts`) + backend endpoints now exist for Wave 13.

---

## Wave 13 — Frontend consumers: manage + viewers + AI-Lead view (3 agents, parallel)

> Each branches off the **Wave-12-merged** base (so `types.ts`/`app.css`/`api.ts` + every endpoint already exist) and owns a **disjoint page tree**. They consume the contract; **none depends on another** (no shared file, no cross-agent need). All read `api.ts`/`types.ts`/`app.css` — none edits them.

### Agent 13A: Manage — remove CC baseline + delete champions/domains
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/pages/manage/*` (consumes `api.ts`/`types.ts` read-only)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Remove CC baseline (type + form) | `types.ts` (drop `Team.cc_baseline` — the one allowed Wave-13 edit to a foundation file) **and** `TeamForm.tsx` (drop the "Current Claude Code status" textarea + `ccBaseline` state + `cc_baseline` submit field) — do both together so the build stays green | item 2 (FE) |
| 2 | Delete buttons (champions + domains) | `ManagePage.tsx` — Delete in the Champions & Domains action columns → `api.champions.delete`/`api.domains.delete` (from 12C) + confirm + `loadAll()` refresh | item 6 (FE) |
**Commit(s):** `Wave 13 Agent 13A: manage (remove CC baseline, champion/domain delete)`

### Agent 13B: Viewer pages — team redesign + status display
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/{pages/team/*, pages/tasks/*, pages/artifacts/*, components/Badge.tsx, components/DomainStory.tsx}` (consumes `types.ts`/`app.css` read-only; owns `team-page.css`)
> **APPROVED DESIGN = source of truth:** `prototype/team-page-mock.html` (+ `prototype/team-page-mock.png` collapsed / `team-page-mock-expanded.png` full). Build to match it. Tasks 1–6 = item 9 (team redesign); tasks 7–9 = item 8 (status display).
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Identity strip | `TeamPage.tsx` — slim top strip: avatar + team/champion name, "since <date>", domain count. **NO CC Baseline** (removed, item 2) | per mock top strip |
| 2 | Tile dashboard (6 count tiles) | `TeamPage.tsx` + `team-page.css` — tight tiles from the Wave-12 count fields: **open tasks, closed tasks, open action items, meetings, domains, artifacts**; each with a sub-callout (e.g. "1 blocked" / "1 overdue" / "last: <date>"); tile click → open + smooth-scroll to its fold + flash | item 9; counts from `TeamPage` (12B #4) |
| 3 | Foldable sections (default collapsed) | `TeamPage.tsx` — native `<details>` folds for **Domains**, **Artifacts (team-wide gutter — NEW fold so the artifacts tile has a home)**, **Reports**, **Action items**; header shows title + count pill + summary mini-pills + chevron | item 9; Artifacts fold = today's all-team gutter |
| 4 | Section internals unchanged | when a fold is expanded, render **today's content** (domain cards, report rows, action-item rows) with full edit behavior intact | item 9: **do NOT redesign internals** |
| 5 | "Last meeting" + overdue touch-ups | last-meeting date on Reports tile/fold; overdue flag on action items — **only when a `due_date` exists** (many tasks/actions have none → never falsely flag overdue) | per mock; Omer: most tasks dateless |
| 6 | Team-page styling | `team-page.css` — tiles, folds, chips, accents per the mock (reuse `app.css` status/type classes; one color per domain on the card's left border) | item 9 |
| 7 | Action items show status | `TeamPage.tsx` `ActionItemsList` — render status (badge/dropdown) instead of `resolved` | item 8 (FE team) |
| 8 | "Won't Fix" on task detail | `TaskDetailPage.tsx` `STATUS_OPTS` += Won't Fix | item 8; references 12C's token/CSS |
| 9 | Ensure `wont_fix` renders | `TasksPage.tsx` `dotClass`, `Badge.tsx` `StatusBadge`, `DomainStory.tsx` — verify the new status renders with the 12C CSS classes | item 8 |
**Commit(s):** `Wave 13 Agent 13B: team page redesign (tiles + folds per approved mock) + action-item status + Won't Fix render`

### Agent 13C: AI-Lead cross-team view (built per the approved mock)
**Type:** `frontend-developer` · **Scope:** `src/frontend/src/{pages/ai-lead/* (new), components/AppShell.tsx, router.tsx}` (consumes `api.aiLead.actionItems` from 12C)
> **APPROVED DESIGN = source of truth:** `prototype/ai-lead-mock.html` (+ `prototype/ai-lead-mock.png`). Build to match it.
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | "AI Lead" nav item | `AppShell.tsx` — new top-level **"AI Lead"** `<NavLink>` in the Overview section, with an open-count badge | item 10; personal cross-team view, NOT a team |
| 2 | Route + page shell | `router.tsx` route → new `pages/ai-lead/AiLeadPage.tsx` | item 10 |
| 3 | Cross-team table | consume `GET /api/ai-lead/action-items` (owner='AI Lead') → rows: action-item text, **team** chip, **meeting date**, **status**, **"Open report ↗"** link to the source report | per mock; 12B #6 |
| 4 | Summary tiles | small counts: Open / Overdue / Blocked / Done | per mock |
| 5 | Sort + group toggle | default "By priority" (overdue→blocked→in-progress→planned→done; closed greyed + sunk); "By team" toggle regroups into team sections | per mock |
| 6 | Inline status edit + dates | status dropdown writes through (full set incl `wont_fix`); "no date" handled; overdue flagged **only when a meeting/due date exists** | per mock; item-8 status set |
**Commit(s):** `Wave 13 Agent 13C: AI-Lead cross-team action-items view (per approved mock)`

### After Wave 13
- Cherry-pick 13A–13C. **Full live walk of the 10-item list:** no CC Baseline; draft places into Backend/Frontend/**General**/**Context creation**; **owner dropdown** {AI Lead/champion/other} defaults champion; action items have LLM-declared **owner** + **status**; tasks show **"Due on"**; **"Won't Fix"** on task & action item; champion/domain **Delete** (domain→General; constants blocked); **team page** count tiles + folds; report columns **aligned**; participants **comma-add** + default champion + **AI Lead**; **"AI Lead" nav** lists cross-team action items owned by AI Lead with content/team/date/status.

---

## Wave 14 — Search bar + DSL on entity pages (design first, then implement)

Integrate the existing chip **SearchBar + DSL** (built for Artifacts/Tasks in Wave 3, `src/frontend/src/search/`) into the **domain, team, and champion** pages — and possibly the team-grouped Manage lists. It needs a design/decisions pass before code, so the wave opens with an exploration+design task (14A); implementation (14B+) is scoped from that spec once Omer approves it.

### Agent 14A: Explore + design SearchBar/DSL integration
**Type:** `ux-researcher` · **Scope:** `specs/search_integration.md` (design spec only — no app code)
| # | Task | Target | Notes |
|---|------|--------|-------|
| 1 | Map where SearchBar + DSL belongs | which of the domain / team / champion pages (and the team-grouped Manage lists) get it; recommend in/out per page with reasons | ground in the Wave-3 search module |
| 2 | Define the DSL keys per surface | which keys apply on each page (reuse team/domain/type/tag/status/date; flag any new key + whether the backend already supports it) | no invented backend |
| 3 | Decide grouped-view filtering | whether/how search interacts with the team-grouped Manage lists (filter within groups? collapse empties?) | resolve with Omer |
**Commit:** `Wave 14 Agent 14A: SearchBar/DSL integration design spec`

### After Wave 14 (14A)
- Omer approves `specs/search_integration.md`; implementation is scoped as a follow-on (14B+) from the approved spec.
