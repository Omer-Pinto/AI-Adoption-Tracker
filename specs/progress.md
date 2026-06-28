# AI Adoption Tracker — Progress Tracker

> **Last updated:** 2026-06-29 | **Branch:** `mvp-improvements` (+ `bug-fixes-mvp-closure` for QA fixes) | **Waves 11–13 + 15 DONE; Wave 16 (1:1 refactor) PLANNED — next to execute**

## Summary

```
Progress: [🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢⬜⬜⬜⬜⬜] 80% (144/180)
```

| Status | Count | % |
|--------|-------|---|
| 🟢 Done | 144 / 180 | 80% |
| 🔵 In Progress | 0 | 0% |
| ⬜ Pending | 36 (Wave 16: 31 · 17: 2 · 18: 3) | 20% |

> Post-Wave-13 extras shipped outside the wave count (UI/deploy/QA): air-gap bundle + Rocky targeting, release skill, version-in-UI, dark mode, logo, AI-Lead toolkit, QA dataset. See git log + the Wave-13 follow-up note.

---

## Wave Status

| Wave | Status | Agents | Cherry-picked | Pending | Notes |
|------|--------|--------|---------------|---------|-------|
| 0 | Done | 2/2 | 2/2 | 0/6 | Setup complete — foundation merged, verified (schema applies, backend boots, frontend builds) |
| 1 | Done | 4/4 | 4/4 | 0/14 | Backend merged + verified (18 routes; report fan-out/replay reads back; q-DSL + autocomplete live) |
| 2 | Done | 3/3 | 3/3 | 0/10 | Merged + verified (air-gapped LLM adapter; report-engine corrections; backend fixes). Post-review fixes: LIKE ESCAPE single-char, prefill-echo tolerance, per-domain replay reset |
| 3 | Done | 4/4 | 4/4 | 0/12 | Frontend merged + verified (combined build clean; DSL↔backend gate; post-review fixes: mention dropdown, form errors, artifact-click dedupe, stable keys). Prep: api.ts wired + types name-only |
| 4 | Done | 1/1 | 1/1 | 0/3 | Seed (canonical §6 via engine) + README run docs + smoke; smoke 35/35 on merged tree (dev.sh helper removed — dev-only, not app) |
| 5 | Done | — | — | 0/2 | Decisions signed off (5.1); live OpenAI draft test (5.2) passed — schema-valid report from raw notes (extraction *quality* gaps moved to Wave 5.5/6) |
| 5.5 | Done | 7/7 | 7/7 | 0/27 | 5.5A–F done+verified (backend correctness, extraction safety-net, report-flow UX, General catch-all + per-item domain picker). 5.5G domain redesign BUILT (text→domains extraction, symmetric cross-links, scope removed, priority free-text, shared DomainForm). Domain-add UX consolidation moved out to Wave 6 |
| 6 | Done | 1/1 | 0/1 | 0/3 | 6A spec **APPROVED by Omer** → `specs/domain_add_ux.md`. DECISION: two buttons — "+ Add Domain" (manual modal) + "Smart domain extract" (page). Verdict: extract flow is a page, not a modal. Commit batched with Wave 7 |
| 7 | Done | 1/1 | 1/1 | 0/4 | Domain-add implementation DONE + build-verified — two buttons (+ Add Domain → manual modal; Smart domain extract → `/domains/extract` page); empty-name Save guard; numeric priority + sorted list (nulls last); 5B re-extract warning; no-results state; old grey link removed |
| 8 | Done | 1/1 | 1/1 | 0/6 | 8A FLAT redesign (`194fef0`+`2d559ef`): top-level `tasks`/`artifacts`, entity `id` + domain `domain_id`/`domain` matching, `report_schema.json` deleted, `extra="forbid"`, `summary`. **G1 APPROVED by Omer**; G2 structured-output audit **PASS**. |
| 9 | Done | 1/1 | 1/1 | 0/4 | Flat id-based engine (`d696420` + dup-fix `2554a35` + cleanup `c6f584a`). Team-scoped id-bearing `build_draft_context`; id-matched save with **id back-fill**; replay back-fills too so an entity added on EDIT can't duplicate (CRITICAL review catch, fixed+proven); domain-changes machinery removed; `summary`/`note` split; `seed.py` reseeded flat (§6 intact). Verified in worktree throwaway DB (no-dup across save/edit-add/re-edit; §6 trace); `import app` clean on mvp. Full live test needs Wave 10 editor UI. |
| 10 | Done | 4/4 | 4/4 | 0/3 | Report editor REDESIGNED via prototype (Omer-approved flat-tables design). Backend (`b674a08`): `GET /api/teams/{id}/entities` picker endpoint + entity-detail `domain` + current-state `PATCH /api/tasks|artifacts/{id}` (no history). Frontend: task+artifact **detail pages** (`77a9f49`, dates-only history, contextual Edit, status read-only) + **flat report editor** (`74d81d2`: flat all-inline-editable tables, matched→link chip / NEW↔existing both ways, `@`/`#` triggers→icon-chips, discussion/issues as lists, domain colors). Each piece api-designed/code-reviewed/fixed. Full FE build green. **Live draft path needs Omer's LLM .env.** Open: discussion/issues are now single-line list items (see note) |
| 11 | **Done** | — | — | 0/3 | **Gate CLOSED** — `mvp-improvements` cut, old DB deleted, contract frozen, team-page + AI-Lead mocks approved. Ready for Wave 12 |
| 12 | **Done** | 3/3 | 3/3 | 0/21 | **Built + verified.** 12A/12B/12C cherry-picked (`8d55d8e`..`70104d3`). Uncertainty gate → 3 FIX-NOW (sticky due_date, owner-survives-replay, 204 body); review → 2 fixes (domain-delete FK, FE contract types); simplified (shared TERMINAL_STATUSES). Backend import OK (36 routes), schema verified, 45/45 journal tests, FE build green. Live round-trip = Omer |
| 13 | **Done** | 3/3 | 3/3 | 0/18 | **Built + verified.** 13A/13B/13C cherry-picked clean (`bf5feb6`..`5fbef2f`, no conflicts — disjoint). Uncertainty gate → 1 FIX-NOW (artifacts fold = full catalog, not just gutter); review → 2 fixes (AI-Lead tile cursor/hover bleed, stable sort comparator); simplified (team-page CSS namespaced under `.team-page`, band-aid dropped). `npm run build` green (66 mods, tsc clean), `import app` OK (36 routes), 45/45 journal tests — tracker.db untouched throughout. **Live 10-item walk + draft round-trip = Omer (.env).** Type tidy (dead `cc_baseline`/`ended_on`/`resolved`) still deferred |
| 15 | **Done** | 2/2 | 2/2 | 0/8 | **Built + verified.** api-designer gate froze the CRUD contract → 15A/15B cherry-picked clean (`e731dfe`..`f939cb5`, disjoint backend/FE). Uncertainty gate → 0 FIX-NOW (all FINE/DEFER); review → clean; simplified (dead CSS swept, shared `_require_non_blank_text`, docstrings). 45/45 journal scenarios + 16/16 live TestClient smoke (standalone CRUD, 409 delete/text guards on meeting-derived, 404, standalone-first ordering, migration row-preserving), FE build green (69 mods), `import app` OK (43 routes). Live migration applied to real empty DB (`report_id` now nullable, 0 rows). tracker.db untouched. **Live UI walk = Omer.** |
| 16 | **Not Started — NEXT (PLAN ONLY)** | 0/8 | 0/8 | 31/31 | **One champion per team (1:1 refactor).** Fold champion into team (`team.champion_name NOT NULL` + `champion_start_date`; drop `champion` table); key everything by `team_id`; team page `/teams/:teamId`; drop the report champion-picker; nuke dead `cc_baseline`/`baseline_date`; recreate DB clean; fix QA dataset (Web-Experience 2→1 champion). Phased: **16.A** contract gate → **16.B** backend core + routes + FE-foundation (×3 parallel) → **16.C** FE consumers (×3 parallel) → **16.D** DB recreate + QA + integration verify. Designed by architect-reviewer off 2 coupling explorations; 4 owner decisions locked. **Planned, NOT executed.** See `task_breakdown.md` Wave 16 |
| 17 | Not Started · ⏸ DEFERRED | — | — | 0/2 | **Deferred behind Wave 16.** Go-live walkthrough — README_HUMAN install/run + `backup_db.sh`. See `task_breakdown.md` Wave 17 |
| 18 | Not Started · ⏸ DEFERRED | 0/1 | 0/1 | 3/3 | **Deferred behind Wave 16.** Search bar + DSL on entity pages — 18A explore+design, then implement (18B+). See `task_breakdown.md` Wave 18 |

**Wave status values:** `Not Started` → `In Progress` → `Cherry-picking` → `Verifying` → `Done`

---

## Wave 0 — Setup

### Agent 0A: Backend foundation (`src/backend/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.1 | Scaffold (FastAPI app, db.py, run script, pre-wired routers) | 🟢 Done | CORS app, 4 routers pre-wired, schema-on-startup |
| 0.2 | DB schema (schema.sql, all §5 tables) | 🟢 Done | 9 tables, CHECK enums, WAL+FK; matches §5 exactly |
| 0.3 | Contracts (models, report JSON Schema, LLM interface, api_contract.md) | 🟢 Done | +teams-index & GET report endpoints added to contract |

### Agent 0B: Frontend foundation (`src/frontend/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.5a | Scaffold (Vite/React/TS shell, router stubs) | 🟢 Done | 9 routes pre-wired to stub pages; AppShell matches mvp look |
| 0.5b | Primitives (api client, Modal, DataTable, Badge, ArtifactDetailModal) | 🟢 Done | api.ts conformed to frozen contract |

### Orchestrator
| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.4 | Copy SoccerSmartBet search source (`cp`, read-only safety) | 🟢 Done | Vendored to search/ dirs; soccer imports stripped; external repo untouched |

---

## Wave 1 — Backend

### Agent 1A: Management API (`routes/management.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team CRUD | 🟢 Done | + cc_baseline; PATCH null-on-required → 422 |
| 2 | Champion CRUD | 🟢 Done | ?team_id filter |
| 3 | Domain CRUD | 🟢 Done | ?team_id/?champion_id filters |

### Agent 1B: Views & lists API (`routes/views.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team page aggregate (+ all-team gutter) | 🟢 Done | `{id}` = champion id; all_team_artifacts gutter |
| 2 | Domain page aggregate | 🟢 Done | current + full history |
| 3 | Task list + detail (history) | 🟢 Done | list filters via 1D `q` seam |
| 4 | Artifact list + detail (modal data) | 🟢 Done | `{task,history}`/`{artifact,history}` wrappers |

### Agent 1C: Report engine + LLM drafting (`reports/`, `routes/reports.py`, `llm/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Draft endpoint (notes → structured) | 🟢 Done | 503 when LLM unconfigured |
| 2 | Confirm/save fan-out (transaction) | 🟢 Done | spec §6 self-test passes; typeless-artifact → 422 |
| 3 | Edit + replay | 🟢 Done | replays champion timeline in date order |
| 4 | LLM adapter impl (pluggable) | 🟢 Done | env `TRACKER_LLM_ENDPOINT`; stdlib urllib |

### Agent 1D: Search DSL (`search/`, `routes/search.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Adapt parser/compiler to SQLite + our keys | 🟢 Done | SQLite `:name` binding; enum keys not slug-expanded |
| 2 | Wire into tasks & artifacts list queries (`q` param) | 🟢 Done | `filter_tasks`/`filter_artifacts` seam consumed by 1B |
| 3 | Autocomplete value endpoints | 🟢 Done | `/api/search/values` tagged {key,kind,values} |

---

## Wave 2 — LLM integration & report baseline

### Agent 2A: LLM endpoint adapter (`llm/`, `.env`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Provider-agnostic client (OpenAI + Anthropic; config selects) | 🟢 Done | Air-gapped: provider = wire format (openai/anthropic-compatible); stdlib urllib, no SDK |
| 2 | URL + key from `.env` (2 entries); `.env` git-ignored immediately | 🟢 Done | All 4 required: PROVIDER+ENDPOINT+API_KEY+MODEL; no hosted defaults/URLs; `.env.example` added |
| 3 | Wire `draft_report` to real provider call (503 only when unset) | 🟢 Done | 503 only when any of the 4 vars unset; LLMRequestError for set-but-down; verified |
| 4 | Test path with a real key via `.env` | 🟢 Done | Anthropic JSON forced via `{` prefill + echo-tolerant parse |

### Agent 2B: Report engine corrections (`reports/engine.py`, `report_schema.json`, `models.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | First meeting = first report (no pre-seed; cc_baseline + artifacts added) | 🟢 Done | Confirmed no pre-seed assumption remained |
| 2 | `started_on` = earliest report mentioning the task; close §6 date question | 🟢 Done | Earliest mentioning meeting_date |
| 3 | Finish date user-supplied (never auto-compute `ended_on`); default meeting date, per-task override | 🟢 Done | New optional `finished_on` on task entry; default = meeting_date; trailing-run guess removed |
| 4 | Edits recompute ALL reflected fields incl. domain (desc/scope/priority); reset on removal (keep baseline/history) | 🟢 Done | Per-domain replay reset: only NULLs fields a report for THAT domain set; preserves management-CRUD values |

---

### Agent 2C: Backend fixes (`routes/management.py`, `search/compiler.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Bad reference → clean 4xx (not 500) | 🟢 Done | 404 on all FK paths (champion.team_id, domain.team_id/champion_id, create+PATCH) |
| 2 | Search escapes `%`/`_` in name matching | 🟢 Done | `_like_escape` + `ESCAPE '\'` (single-char fix; earlier `'\\'` broke all name searches — caught in post-merge verify) |

## Wave 3 — Frontend

### Agent 3A: Management UI (`pages/manage/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Lists (teams/champions/domains, Add/Edit) | 🟢 Done | Tabbed DataTables |
| 2 | Isolated edit modal form | 🟢 Done | One modal per entity; submit try/catch/finally + visible error |

### Agent 3B: Team & Domain pages (`pages/team/`, `pages/domain/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team page (portfolio + story + gutter + create report) | 🟢 Done | Champion portfolio; all-team gutter; Create-report nav |
| 2 | Domain page (current + full story) | 🟢 Done | Current tables + week-by-week timeline |
| 3 | Artifact detail modal usage | 🟢 Done | Single-fire click (stopPropagation) + error-handled fetch |

### Agent 3C: Report flow UI (`pages/report/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create (notes → draft) | 🟢 Done | Champion (pre-selectable via `?champion=`) + notes → draft |
| 2 | Preview → confirm | 🟢 Done | "Not saved" banner; Confirm/Discard; stable block keys |
| 3 | Edit saved report | 🟢 Done | Structured form (PATCH/replay); stable block keys |
| 4 | `@` task / `#` artifact mentions (fuzzy, all items, Jira-style; pick existing or type new) | 🟢 Done | Client-side fuzzy; dropdown keystroke bug fixed; name-only (backend resolves) |

### Agent 3D: Artifacts, Tasks & Search bar (`pages/artifacts/`, `pages/tasks/`, `search/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Adapt chip search bar to React (autocomplete, URL round-trip) | 🟢 Done | DSL verified vs backend parser; enum verbatim round-trip; single-date semantics |
| 2 | Artifacts page (filtered, modal) | 🟢 Done | SearchBar-driven; modal error path retry-able |
| 3 | Tasks page (filtered, week-by-week expand) | 🟢 Done | Expand→history; error-handled |

---

## Wave 4 — Integration & seed

### Agent 4A: Seed + smoke (`seed.py`, `scripts/`, `README.md`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Seed script (via the report engine path) | 🟢 Done | `seed.py` fans out §6 Radar/Dana trace via real engine; + illustrative Platform/Eli |
| 2 | Run command + README (model-endpoint env var) | 🟢 Done | README documents run (backend + frontend, 2 terminals) + 4 LLM env vars + `.env` not auto-loaded. (dev.sh helper removed per Omer — dev-only convenience, not the app) |
| 3 | Smoke pass (create→appears everywhere; search; modal; edit+replay) | 🟢 Done | `scripts/smoke.py` 35/35: §6 read-back, search filters, edit/replay no-dup (domain-scoped) |

---

## Wave 5 — Decisions sign-off (gate)

### Gate: resolve open decisions (orchestrator + Omer)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Every item in `specs/decisions.md` closed — nothing left TBD | 🟢 Done | Batched audit (LLM, report engine, search, mentions) + orchestrator spot-check of the code: all 15 logged decisions implemented & correct; zero open |
| 2 | Live LLM test — 1–2 report drafts from notes via real OpenAI API (schema-valid, sensible output) | 🟢 Done | Ran raw + curated notes through real gpt-4o → schema-valid `ReportDocument` both times; rendered in the Create Report preview. Extraction *quality* gaps (dropped items on messy notes) tracked in Wave 5.5/6 |

---

## Wave 5.5 — Stabilization (bugs + edit/save UX)

> Reproduced live before planning (see `specs/task_breakdown.md` Wave 5.5). `@`/`#` mentions were verified WORKING — not in scope.

### Agent 5.5A: Backend correctness fixes (`routes/views.py`, `routes/management.py`, `routes/reports.py`, `reports/engine.py`, `schema.sql`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Domain ordering: NULL priority sorts last | 🟢 Done | `ORDER BY priority IS NULL, priority, id`; live-verified priority-1 before NULL |
| 2 | Reject duplicate `(champion, meeting_date)` → 422 | 🟢 Done | UNIQUE + engine guard (PATCH-self excluded); live 422 with clear msg |
| 3 | Cross-team champion on domain → 422 | 🟢 Done | create+patch validated; live 422 with clear msg |
| 4 | Surface fan-out validation errors (UI-consumable body) | 🟢 Done | typeless-artifact → 422 `detail`; surfaced in UI |
| 5 | Typed `response_model` on report endpoints | 🟢 Done | `ReportResponse`; OpenAPI now typed (verified) |
| 6 | Auto-create domains from the report (no manual pre-define) | 🟢 Done | live: report naming new "Platform Tooling" → 201, domain created w/ scope+priority; replay still correct |

### Agent 5.5B: LLM extraction safety-net (`llm/interface.py` — `_SYSTEM_PROMPT`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | No note line dropped (overflow to discussion/issues; raw_notes verbatim) | 🟢 Done | live: off-schema lines → discussion/issues, nothing dropped |
| 2 | New artifacts always typed (never emit a typeless new artifact) | 🟢 Done | live: `radar-helper`→`skill` (inferred) |

### Agent 5.5C: Report-flow + manage UX (`pages/report/*`, `pages/manage/*`, edit links on tasks/artifacts/team)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Preview parity — action items/discussion/issues editable in preview | 🟢 Done | live: action items Edit/×/+Add inline; discussion/issues textareas |
| 2 | Require artifact type + surface backend 422 on save | 🟢 Done | guard + error banner (build clean; api.ts surfaces `detail`) |
| 3 | Edit discoverability — link to owning report's edit page | 🟢 Done | `report_id` present on tasks/artifact-modal/team; links wired |
| 4 | CC Baseline as multi-line textarea | 🟢 Done | live: textarea on team add/edit form |

### Agent 5.5D: Navigation & preview clarity (`components/AppShell.tsx`, `pages/report/*`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Sidebar "＋ New Report" → /reports/new | 🟢 Done | top of Main nav; unblocks Manage-only users |
| 2 | Label domain sections "Domain: X" in preview/edit | 🟢 Done | live-verified |
| 3 | Render team-wide artifacts block in preview/edit | 🟢 Done | top-level artifacts block + domain picker |

### Agent 5.5E: Domain semantics + team-wide artifacts (`models.py`, `report_schema.json`, `reports/engine.py`, `llm/interface.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Top-level team-wide `artifacts` slot in `ReportDocument` (fan-out/replay → domain_id NULL) | 🟢 Done | engine fan-out+replay handle it |
| 2 | Prompt: domains = team tech/stacks only; never invent "Claude Code"/heading domains | 🟢 Done | superseded by 5.5F (use only existing domains) |
| 3 | Prompt: group don't explode (md files → one context artifact); only concrete artifacts | 🟢 Done | live: md-files pack → ONE context artifact |

### Agent 5.5F: Context-driven assignment + General domain + domain picker
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Prompt: use only existing domains; assign best-fit; "General" fallback; never invent | 🟢 Done | live: auth→Backend, context pack→General, no Claude-Code domain |
| 2 | Prompt: existing-vs-new via context + "new" convention | 🟢 Done | temp-DB verified: existing referenced, "new" created |
| 3 | Per-champion "General" catch-all domain (ensured at draft) | 🟢 Done | `_ensure_general_domain`; in context+UI |
| 4 | UI domain picker per task/artifact (preview+edit), moves between domains | 🟢 Done | live: moved context pack General→Backend |

### Agent 5.5G: Domain setup redesign — text→domains extraction + symmetric links (BUILT, commit b336eaf)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `POST /api/domains/extract` (text → domain proposals) via SDK + Pydantic | 🟢 Done | live: 4 domains, priority ranked from "1→4→3→2" |
| 2 | Remove `scope` everywhere; `priority` → free TEXT | 🟢 Done | schema/models/report_schema/engine/routes/frontend |
| 3 | Symmetric `domain_link` cross-domains across ALL teams ("Team: Domain") | 🟢 Done | live: add+remove propagate both ways |
| 4 | Shared `DomainForm` (edit + approve-extracted) + "Set up domains" flow | 🟢 Done | live setup flow; champion auto when sole |
| 5 | CC Baseline relabeled "Current Claude Code status" + real placeholder | 🟢 Done | |

---

## Wave 6 — Domain-add UX consolidation

> Wave 6 = the UX design spec only (no code). Implementation is the separate Wave 7 — agents in a wave run in parallel, so the build cannot share the design's wave. See `specs/task_breakdown.md` Wave 6.

### Agent 6A: Domain-add UX design (spec only — `specs/domain_add_ux.md`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Domain-add entry points | 🟢 Done | DECIDED: two labelled buttons — "+ Add Domain" (manual) + "Smart domain extract" |
| 2 | Two add modes specced (manual single + LLM multi-extract) | 🟢 Done | manual → modal; extract → page |
| 3 | Surface decision (modal vs page) | 🟢 Done | VERDICT: extract flow is a **page** (N-record approval queue + click-outside data-loss); manual stays a modal |

---

## Wave 7 — Domain-add implementation

> Builds exactly what Wave 6's approved spec defines — single agent, runs after the spec lands. See `specs/task_breakdown.md` Wave 7.

### Agent 7A: Two-button domain-add (manual modal + smart-extract page) (`pages/manage/*`, `pages/domain/DomainSetupPage.tsx`, `router.tsx`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Two labelled buttons; drop old grey "Set up domains" link; sort domains by numeric priority (nulls last) | 🟢 Done | `ManagePage.tsx`: "+ Add Domain" → modal, "Smart domain extract" → `/domains/extract`; `sortedDomains` |
| 2 | Manual modal: block Save on empty Name (inline error); Priority → numeric input | 🟢 Done | `DomainForm.tsx`: Save disabled when Name blank; `type=number min=1`, hint "Lower number = higher priority" |
| 3 | Smart-extract page: 5B re-extract warning (per-card dirty); no-results empty state; one champion/batch; close-no-warning | 🟢 Done | `DomainSetupPage.tsx`: `window.confirm` on dirty re-extract; "No domains found…" state |
| 4 | Routing: button → extract page; remove old grey-link; no redirect | 🟢 Done | `router.tsx`: route renamed `domains/setup` → `domains/extract` |
**Verification:** `npm run build` (tsc -b && vite build) PASSED — 63 modules, no errors. No stale `/domains/setup` refs.

---

## Wave 8 — Report schema + mining prompt + both-provider structured output (1 agent + 2 gates)

> The contract everything downstream depends on. Single build agent on `llm/interface.py` + `models.py` + `report_schema.json` (engine is the next wave, different file). 2 Omer gates close it. Omer tests live. See `task_breakdown.md` Wave 8.

### Agent 8A: Simplify schema + mining prompt + both-provider structured output (`llm/interface.py`, `models.py`, `report_schema.json`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Simplify report — FLAT shape, existing domains only | 🟢 Done | flattened to top-level `tasks`/`artifacts`; nested domain tree + `ReportDomainSection`/`ReportDomainChanges` + separate team-wide list all removed; `report_schema.json` DELETED (Pydantic = sole source); `extra="forbid"` on all sub-models |
| 2 | Rewrite `_SYSTEM_PROMPT` to MINE (single-shot) | 🟢 Done | flat mining; completeness via list membership; action-items no-overlap with discussion/issues; discussion=default catch-all, issues=problems; champion/date/verbatim raw_notes/grouping/always-typed/no-fabrication kept |
| 3 | Per-entity matching: `id` for entity AND `domain_id`+`domain` | 🟢 Done | task+artifact+action-item carry entity `id` (null=new) and domain `domain_id`+`domain` (both null=unplaced/team-wide); CRITICAL asymmetry: null `domain_id` never mints a domain. `summary` added to artifacts (entity-aligned, distinct from `note`) |
| 4 | Structured output for BOTH providers, validated | 🟢 Done | both paths derive from `ReportDocument`; OpenAI strict builds with nullable id/domain_id; extra=forbid rejects unknown/old-shape; matched/new/team-wide validate. NER/multi-shot considered → single-shot kept (closed-catalog linking; revisit only if dups appear) |

### Wave 8 gates — Omer authorization (orchestrator-run; not parallel agents)
| # | Gate | Status | Notes |
|---|------|--------|-------|
| G1 | Omer reviews & approves rewritten prompt + flat `ReportDocument` schema | 🟢 Done | **APPROVED by Omer**; greenlit Wave 9. Live-feel test deferred to Wave 10 UI |
| G2 | `ai-engineer` confirms both providers' structured outputs implemented + validated | 🟢 Done | ai-engineer audit **PASS** (OpenAI strict + Anthropic forced-tool, extra=forbid aligns both) |

---

## Wave 9 — Report engine: team-scoped context + id-based save (1 agent)

> Builds against Wave 8's approved schema/prompt. One agent — owns `reports/engine.py` (context + save), can't be split on the same file. See `task_breakdown.md` Wave 9.

### Agent 9A: Team-scoped context + id-based save + new-in-preview (`reports/engine.py`, `routes/reports.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team-scoped context — `build_draft_context` passes the team's tasks/artifacts/domains, each with `id` | 🟢 Done | team-scoped; tasks `{id,name,status,owner,domain_id,domain}`, artifacts `{id,...,domain_id,domain}`, domains `{id,name,description}`; `champion_name` key kept; General ensured |
| 2 | Domains for placement (existing only); `domain_id`+`domain` per entry; null=unplaced (General/team-wide), never mints a domain | 🟢 Done | resolve-only domain helper; domain-changes machinery removed from save+replay |
| 3 | Matched entry → resolve by `id` to that exact row (no fuzzy, no duplicate); **id back-fill** on save AND replay | 🟢 Done | foreign-id rejected (team-scope verify→422); back-fill persists resolved ids so edit-added entities can't duplicate (CRITICAL review catch, fixed) |
| 4 | New (id-None) entry → created on confirm; surfaced as NEW for the editor (Wave 10) | 🟢 Done | engine creates on save; `summary`/`note` split fixed; `seed.py` flat (§6 intact). Worktree throwaway-DB proof: no dup across save/edit-add/re-edit |

---

## Wave 10 — Report editor: JIRA-style links + team-scoped @/# mentions + NEW markers (frontend)

> Consumes Wave 9's id-returning draft. Scope EXPANDED after a prototype review with Omer (3 mock iterations → approved flat-tables design at `prototype/report-editor-prototype.html`). Built as 4 focused, individually code-reviewed pieces. See `task_breakdown.md` Wave 10.

### Backend endpoints (`routes/views.py`, `b674a08`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 0 | Picker endpoint + entity-detail domain + current-state PATCH | 🟢 Done | api-designed (no DSL shortcut). `GET /api/teams/{id}/entities`; `domain` on task/artifact detail; `PATCH /api/tasks|artifacts/{id}` writes current-state only (report-only history) |

### Frontend — detail pages (`77a9f49`) + flat report editor (`415b174`+fix `74d81d2`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Matched entries → linked chips → real **detail pages** (task & artifact, consistent, contextual Edit, dates-only history) | 🟢 Done | task status read-only ("from reports"); both pages reachable by id |
| 2 | `@`/`#` **triggers** → inline icon-chips linked by id; team-scoped via `/teams/{id}/entities` | 🟢 Done | raw `@`/`#` removed on pick; single-line editor (no `\n` loss); token names escaped |
| 3 | NEW markers + flat all-inline-editable tables; NEW↔existing both directions; discussion/issues as lists; domain colors | 🟢 Done | matches approved prototype; save payload allowlist-clean (extra=forbid safe) |
| — | Live draft→preview→save→edit round-trip | ⬜ Omer | needs LLM `.env`; build-verified + reviewed, not yet run live |

---

## Wave 11 — Frozen Contract, branch & AI-Lead design (gate — NO code) — 🟢 DONE

> **Wave mechanics:** a wave = fully-parallel independent agents; any dependency → a separate consecutive wave. The contract gets its own wave. Chain: contract (11) → backend + FE-foundation build it (12) → FE consumers branch off Wave-12 (13) → search (14). All on `mvp-improvements`. Full Frozen Contract in `task_breakdown.md` Wave 11.2.

### Wave 11 — Gate tasks (orchestrator + Omer) — CLOSED
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Commit specs to `mvp-spec`; cut `mvp-improvements` off it | 🟢 Done | `d1b6f41`; `mvp-spec` intact as revert point |
| 2 | Delete local `tracker.db` ("leave no old db") | 🟢 Done | removed; regenerates from new schema; `.bak` left |
| 3 | Item-10 AI-Lead design + item-9 team-page design approved by Omer | 🟢 Done | mocks frozen: `prototype/team-page-mock.*`, `ai-lead-mock.*`; contract decisions all closed (due-date pickable, domain delete→General, champion delete 409-if-reports) |

---

## Wave 12 — Backend core + routes + FE-foundation/report-editor (3 agents, parallel) — 🟢 DONE

> Built the Wave-11 contract into code on disjoint trees; all cherry-picked + verified on `mvp-improvements`.

### Agent 12A: Backend core — schema, models, engine, prompt, seed, search (`python-pro`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Remove cc_baseline + baseline_date | 🟢 Done | gone from schema/models/seed (verified absent) |
| 2 | Task `ended_on`/`finished_on`→`due_date` + drop terminal gate | 🟢 Done | free date; **review fix**: sticky walk-back (a later silent report no longer wipes it) |
| 3 | Add `wont_fix` status (enum + CHECKs + terminal) | 🟢 Done | in 3 CHECKs + TaskStatus |
| 4 | Action-item status (drop `resolved`) | 🟢 Done | status default `planned` |
| 5 | Owner: default champion + LLM-declared action-item owner | 🟢 Done | **review fix**: champion owner now survives edit-replay |
| 6 | "Context creation" constant domain (priority 1) | 🟢 Done | + General; both in draft context |
| 7 | Fix + re-verify tests & seed | 🟢 Done | 45/45 journal scenarios (throwaway DB) |
| G | ai-engineer review of prompt/structured-output diff | 🟢 Done | audit **PASS** (`c6dde3a`); fixed: prompt now mines action-item `status` + champion-default for null action-item owner |

### Agent 12B: Backend routes — management, views, counts, cross-team endpoint (`backend-developer`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Drop cc_baseline from `TeamCreate`/`TeamUpdate` | 🟢 Done | |
| 2 | `DELETE /api/champions/{id}` (409 if has reports) | 🟢 Done | |
| 3 | `DELETE /api/domains/{id}` (reassign→General; block constants) | 🟢 Done | **review fix**: also reassigns action_items (was 500 on FK) |
| 4 | Team-page counts on `TeamPage` | 🟢 Done | 7 count fields |
| 5 | `TaskPatch.due_date`; `_action_item` status | 🟢 Done | |
| 6 | `GET /api/ai-lead/action-items` | 🟢 Done | route present; consumed by 13C |

### Agent 12C: FE foundation (types/css/api.ts) + report editor (`frontend-developer`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | FE type contract — additive (TaskStatus+wont_fix, +action-item status, due_date rename; LEFT Team.cc_baseline for 13A) | 🟢 Done | + **review fix**: `AILeadActionItem` type, `TeamPage` count fields |
| 2 | FE css contract (status tokens) + table alignment + participants css | 🟢 Done | wont_fix = slate |
| 3 | api.ts methods (`champions.delete`, `domains.delete`, `aiLead.actionItems`) | 🟢 Done | + **review fix**: `request()` tolerates 204 |
| 4 | Participants comma-add + default champion/AI Lead | 🟢 Done | |
| 5 | Owner dropdown {AI Lead/champion/other} | 🟢 Done | "other"→free text |
| 6 | "Finished on"→"Due on" | 🟢 Done | |
| 7 | Action-item status column + Won't Fix option | 🟢 Done | |

> **⚠ Wave-13 prep note (from the Wave-12 code review — resolve before launching Wave 13):** the backend renames (`ended_on`→`due_date`, `cc_baseline` removed, `resolved`→`status`) are done, and 12C kept the FE entity types additive so the build still compiles — but ~6 **Wave-13-owned** FE files still read the dead fields and will show `—`/wrong state until updated: `TaskDetailPage.tsx` & `TasksPage.tsx` (`ended_on`→`due_date`), `pages/domain/DomainPage.tsx` (`ended_on` — **currently unscoped, add it**), `TeamForm.tsx`/`ManagePage.tsx`/`TeamPage.tsx` (`cc_baseline`), `TeamPage.tsx` `ActionItemsList` (`resolved`→`status`). **Coupling risk:** finishing the `types.ts` cleanup (add `due_date` to `Task`/`TaskHistory`/`TaskPatchBody`, drop `Team.cc_baseline`/`ActionItem.resolved`) touches a file both 13A and 13B consume → decide one owner for the final `types.ts` pass (or keep it additive) before launching, else 13A/13B collide on `types.ts`.

---

## Wave 13 — FE consumers: manage + viewers + AI-Lead (3 agents, parallel — disjoint files)

> Branch off Wave-12. Disjoint file sets: 13A=`pages/manage/*`; 13B=`types.ts`(additive)+`pages/team|tasks|artifacts|domain/*`+`Badge.tsx`/`DomainStory.tsx`; 13C=`pages/ai-lead/*`+`AppShell.tsx`+`router.tsx`. 13B is the sole `types.ts` editor (additive `due_date` on the Task types). Dead optional type fields left as deferred tidy.

> **Post-Wave-13 follow-up fixes (commits `96d0c19`..`a9831ee`, not a new wave):** rebuilt the empty (table-less) `tracker.db` that was 500'ing every endpoint; added `PATCH /api/action-items/{id}` (api-designed) + `due_date` passthrough so the AI-Lead status/due_date **persist** and overdue keys off the real `due_date`; clean **empty/error states across all list & viewer pages** (shared `EmptyState`/`ErrorState`); NITs (404→friendly "not found", loader cancel-guards, `console.error` in swallowed catches). Backend now runs with `--reload`; servers kept fresh by the orchestrator. Only the dead-type tidy remains deferred.

### Agent 13A: Manage — remove CC baseline UI + delete (`frontend-developer`) — 🟢 DONE (`bf5feb6`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Remove CC baseline from `TeamForm`/`ManagePage` UI (leave optional type) | 🟢 Done | textarea + state gone; sends `cc_baseline:null` (field still required in types.ts — deferred tidy) |
| 2 | Delete buttons (champions + domains) → `api.*.delete` | 🟢 Done | confirm() + `alert(err.message)` surfaces backend 409/block; `loadAll()` refresh |

### Agent 13B: Viewer pages — team redesign + due-date/status display (`frontend-developer`) — 🟢 DONE (`261b366`)
> Design = `prototype/team-page-mock.html` (+ `.png`/`-expanded.png`). Sole `types.ts` editor (additive).
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Add `due_date` to Task/TaskHistory/TaskPatchBody types (additive) | 🟢 Done | `due_date?: string\|null` (matches `ended_on` nullable convention); `ended_on`/`resolved` kept |
| 2 | Identity strip (no CC Baseline) | 🟢 Done | avatar + name + "since" + domain count |
| 3 | Tile dashboard — 6 count tiles + click-to-fold | 🟢 Done | counts from 12B; tile→fold open+scroll+flash; sub-callouts client-computed |
| 4 | Foldable sections (Domains/Artifacts/Reports/Actions, default collapsed) | 🟢 Done | native `<details>`; **gate fix:** Artifacts fold = FULL catalog (matches tile + mock), not just gutter |
| 5 | Section internals unchanged when expanded | 🟢 Done | wraps existing DomainCard/rows; no internal redesign |
| 6 | Last-meeting + overdue (only if date) | 🟢 Done | overdue = `due_date` present AND `<today` AND not terminal |
| 7 | team-page.css per mock | 🟢 Done | namespaced under `.team-page` (post-merge simplification — no cross-page bleed) |
| 8 | Action items show status (not resolved); drop cc_baseline display | 🟢 Done | `StatusBadge(item.status)`; cc_baseline removed |
| 9 | Tasks show "Due on" (`due_date`) + Won't Fix — TaskDetail/TasksPage/DomainPage | 🟢 Done | DomainPage gap closed |
| 10 | Ensure `wont_fix` renders (lists/badges/dots) | 🟢 Done | Badge "Won't Fix", dot/StatusBadge/DomainStory via 12C CSS |

### Agent 13C: AI-Lead cross-team view (`frontend-developer`) — 🟢 DONE (`5fbef2f`)
> Design = `prototype/ai-lead-mock.html` (+ `.png`).
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | "AI Lead" nav item + open-count badge (`AppShell`) | 🟢 Done | NavLink + open-count badge (independent fetch) |
| 2 | Route + page shell (`pages/ai-lead/*`) | 🟢 Done | `AiLeadPage.tsx` + scoped `ai-lead-page.css` (`.ai-lead-page` namespace) |
| 3 | Cross-team table (text/team/date/status/Open-report) | 🟢 Done | consumes `api.aiLead.actionItems()`; Open-report → `/reports/{id}/edit` |
| 4 | Summary tiles (Open/Overdue/Blocked/Done) | 🟢 Done | per mock |
| 5 | Sort "By priority" + "By team" toggle | 🟢 Done | priority sort uses stable comparator (post-review fix) |
| 6 | Inline status edit + no-date/overdue handling | 🟢 Done | **PERSISTED (fixed in 13.1):** status + due_date write through `PATCH /api/action-items/{id}` (optimistic + rollback); overdue now keys off real `due_date`; added inline due-date column |

---

## Wave 17 — Go-live walkthrough (gate, before first air-gap insert)  ·  ⏸ DEFERRED — run AFTER Wave 16

> A focused ~20-min joint pass so Omer's reading is minimal and timed to when it matters. NOT a code wave — orchestrator + Omer. Deep UPGRADING review is deferred to the first real upgrade. **Deferred behind Wave 16 (1:1 refactor)** — no point walking install/backup before the schema refactor lands.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Walk `deployment/README_HUMAN.md` install/run together (Rocky prereqs → install → LLM env → start → verify) | ⬜ Pending | the only must-read for go-live |
| 2 | Walk `deployment/bundle/scripts/backup_db.sh` (run it, confirm a snapshot lands; set a cadence) | ⬜ Pending | data-safety essential |

---

## Wave 15 — AI-Lead board redesign + self-managed action items (Variant B)

> Rebuild the AI-Lead page per the chosen prototype (`prototype/ai-lead-board-redesign.html?variant=B`) + let the AI Lead add/edit/delete their own action items directly. Schema change (nullable `action_item.report_id`) frozen pre-1.0. api-designer gate → 15A backend + 15B FE in parallel. **Locked:** tabbed board, both date columns, no page subtitle, toolkit desc = 2-line textarea, standalone = full CRUD / meeting-derived = status+due only + "Open report" link, no delete. See `task_breakdown.md` Wave 15.

### Gate: action-item CRUD contract (`api-designer`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| G | Freeze POST/DELETE/PATCH-text contract + nullable AILeadActionItem fields | 🟢 Done | Frozen: POST 201→enriched item; DELETE/PATCH-text only when report_id NULL else 409 (`"Cannot delete/edit … Mark it won't_fix or abandoned instead."`); 404 beats 409; standalone (NULL meeting_date) sorts first; PATCH stays bare ActionItem |

### Agent 15A: Backend — report-less action items + CRUD (`backend-developer`) — 🟢 DONE (`e731dfe`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `action_item.report_id` → NULLABLE (recreate table; empty DB) | 🟢 Done | schema nullable + non-destructive startup migration in `db.py` (`_migrate_action_item_report_id_nullable`: PRAGMA-guarded, atomic rebuild, row-preserving, idempotent). Applied live to real empty DB |
| 2 | `AILeadActionItem` nullable + LEFT-JOIN query (standalone rows appear) | 🟢 Done | team/champion/meeting/report_id nullable; INNER→LEFT JOINs; `ORDER BY (meeting_date IS NULL) DESC, …` (standalone first) |
| 3 | `POST /api/action-items` (standalone, owner "AI Lead") | 🟢 Done | `ActionItemCreate` (blank-text→422); owner/report_id/domain_id server-set; 201→enriched `AILeadActionItem` |
| 4 | `DELETE /api/action-items/{id}` (409 if report-derived) | 🟢 Done | 204; 404 missing; 409 if report_id set |
| 5 | Extend `PATCH` for `text` (409 if report-derived) | 🟢 Done | `text` added (409 on report-derived); status/due always; bare `ActionItem` return |
| 6 | Verify replay isolation (standalone untouched) | 🟢 Done | engine `DELETE … WHERE report_id = ?` never matches NULL rows; proven on throwaway DB |

### Agent 15B: Frontend — tabbed board Variant B (`frontend-developer`) — 🟢 DONE (`4987778`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Tabbed board: header "AI Lead" (no subtitle) + tabs [Action items · My toolkit] | 🟢 Done | narration subtitles removed; tabbed Variant-B layout |
| 2 | Action items tab owns stats + toggle + "+ Add" + table (2 date cols) | 🟢 Done | 4 stat cards + priority/team toggle + "+ Add action item" + table (Meeting read-only, Due editable) |
| 3 | Standalone add/edit/delete; meeting-derived status/due only + "Open report" link | 🟢 Done | discriminator `report_id===null`; optimistic create/patch/delete + rollback; meeting rows: "Report-managed" + "Open report ↗" |
| 4 | Toolkit tab; description = 2-line textarea | 🟢 Done | toolkit moved into its tab; live count badge; `<textarea rows={2}>` |
| 5 | api.ts/types: actionItems create/delete + text patch; nullable AILead fields | 🟢 Done | `aiLead.create`/`delete`, `ActionItemPatchBody.text`, `ActionItemCreateBody`, nullable `AILeadActionItem` |
**Verification:** 45/45 journal scenarios + 16/16 live TestClient smoke (throwaway DBs); `npm run build` green (69 modules, tsc clean); `import app` OK (43 routes). Post-merge simplification `f939cb5` (dead CSS swept, shared blank-text validator, docstrings refreshed). **Deferred (consultant-blessed, non-blocking):** standalone items are domain-less by design; `PATCH {status:null}`→500 (pre-existing pattern, also in `patch_task`); minor a11y (tabpanel ARIA, unlabeled status select); priority tiebreak uses `meeting_date DESC`. **Live UI walk = Omer.**

---

## Wave 16 — One champion per team (1:1 refactor)  ·  ⏯ NEXT (PLAN ONLY — not executed)

> Fold the champion INTO the team (`team.champion_name NOT NULL` + `champion_start_date`; drop the `champion` table); key everything by `team_id`; team page `/teams/:teamId`; remove the report champion-picker; **nuke** dead `cc_baseline`/`baseline_date`; recreate the DB clean; fix the QA dataset (Web-Experience 2→1 champion). Designed by `architect-reviewer` off 2 coupling explorations; 4 owner decisions locked (champion_name NOT NULL · nuke cc_baseline · team-chooser fallback · recreate clean). Phased chain (Wave 11→13 pattern). See `task_breakdown.md` Wave 16. **Hand to the executor — do NOT execute yet.**

### Phase 16.A — Contract gate (`api-designer` + Omer sign-off)
| # | Task | Status | Notes |
|---|------|--------|-------|
| G1 | Freeze schema (team+champion fields; drop champion; report.team_id; domain−champion_id) | ⬜ Pending | |
| G2 | Freeze engine signatures (team-keyed; one `_ensure_*_domain`) | ⬜ Pending | |
| G3 | Freeze endpoint contract (drop /champions; team-keyed page/draft/reports) | ⬜ Pending | |
| G4 | Freeze FE types/api (Team += champion, −cc_baseline; one-per-team index) | ⬜ Pending | Omer signs off before 16.B |

### Phase 16.B — Backend core + routes + FE foundation (3 agents, parallel)
#### Agent 16B-1: Backend core (`python-pro` — schema/models/engine/seed)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | New schema | ⬜ Pending | |
| 2 | Models (drop Champion; report/domain re-key; Team += champion) | ⬜ Pending | |
| 3 | Re-key engine to team; delete `_resolve_champion_id`/`_champion_team_id` | ⬜ Pending | |
| 4 | Consolidate to ONE team-keyed `_ensure_*_domain` | ⬜ Pending | kills triple def |
| 5 | Owner-default reads `team.champion_name` | ⬜ Pending | |
| 6 | Seed sets champion_name; domains drop champion_id | ⬜ Pending | ai-engineer gate on engine/prompt diff |
#### Agent 16B-2: Backend routes (`backend-developer`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Remove champion CRUD + `_assert_champion_belongs_to_team` + `?champion_id=` | ⬜ Pending | |
| 2 | Team create REQUIRES champion (team+champion together); update edits in place; NO standalone champion-create | ⬜ Pending | |
| 3 | team_page `{id}`=team_id; team-pages one row/team | ⬜ Pending | |
| 4 | Domains create/patch drop champion_id | ⬜ Pending | |
| 5 | Reports draft/save by team_id | ⬜ Pending | |
| 6 | AI-Lead worklist JOIN report→team | ⬜ Pending | |
#### Agent 16B-3: FE foundation (`frontend-developer` — types/api)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Types per G4 (Team += champion, DELETE cc_baseline/baseline_date) | ⬜ Pending | |
| 2 | api.ts (remove champions.*/listByChampion; team-keyed page/draft/create) | ⬜ Pending | |

### Phase 16.C — FE consumers (3 agents, parallel; off 16.B-merged)
#### Agent 16C-1: Nav + hub (`router.tsx`, `TeamPage`, `TeamsIndexPage`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Route `:championId` → `:teamId` | ⬜ Pending | |
| 2 | TeamPage team-keyed; champion from team fields | ⬜ Pending | |
| 3 | TeamsIndexPage one card per team | ⬜ Pending | |
#### Agent 16C-2: Manage cluster (`ManagePage`, `TeamForm`, `DomainForm`; del `ChampionForm`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Drop Champions tab/grouping/add/delete; tabs Teams·Domains | ⬜ Pending | |
| 2 | TeamForm (create+edit) collects team+champion TOGETHER; NO separate Add-Champion | ⬜ Pending | |
| 3 | DomainForm drop champion select | ⬜ Pending | |
| 4 | Delete `ChampionForm.tsx` | ⬜ Pending | |
#### Agent 16C-3: Report + domain-setup (`pages/report/*`, `DomainSetupPage`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | ReportCreate: remove champion picker; enter by team; team-chooser fallback | ⬜ Pending | |
| 2 | Preview/Edit: drop champion→team hop; team-keyed; live champion name | ⬜ Pending | |
| 3 | DomainSetup: drop champion select/auto-select; team-keyed | ⬜ Pending | |

### Phase 16.D — DB recreate + QA dataset + integration verify (orchestrator + 1 agent)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Expunge + recreate DB clean (new schema; Omer re-enters QA) | ⬜ Pending | Omer-authorized, this DB only |
| 2 | Fix `qa/` dataset → Web-Experience 1 champion; README/setup to 1:1 | ⬜ Pending | merge `*-Daniel`/`*-Rivka` reports |
| 3 | Integration verify (team-keyed pages/links; create-from-team; champion rename → history shows new name; AI-Lead) | ⬜ Pending | live |

---

## Wave 18 — Search bar + DSL on entity pages (design first, then implement)  ·  ⏸ DEFERRED — run AFTER Wave 16

> Opens with a design/exploration task (18A → `specs/search_integration.md`); implementation (18B+) is scoped from the approved spec. **Deferred behind Wave 16.** See `task_breakdown.md` Wave 18.

### Agent 18A: Explore + design SearchBar/DSL integration (spec only — `specs/search_integration.md`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Map where SearchBar + DSL belongs (domain/team/champion pages + grouped Manage lists; in/out per page) | ⬜ Pending | ground in the Wave-3 search module |
| 2 | Define the DSL keys per surface (reuse team/domain/type/tag/status/date; flag any new key + backend support) | ⬜ Pending | no invented backend |
| 3 | Decide grouped-view filtering (filter within team groups? collapse empties?) | ⬜ Pending | resolve with Omer |
