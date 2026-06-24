# AI Adoption Tracker — Progress Tracker

> **Last updated:** 2026-06-24 | **Branch:** `mvp-spec`

## Summary

```
Progress: [🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢⬜⬜⬜] 88% (85/97)
```

| Status | Count | % |
|--------|-------|---|
| 🟢 Done | 85 / 97 | 88% |
| 🔵 In Progress | 0 | 0% |
| ⬜ Pending | 12 (2 = Wave 8 gates · 4 = Wave 9 · 3 = Wave 10 · 3 = Wave 11) | 12% |

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
| 8 | Build done · gates pending | 1/1 | 1/1 | 2/6 | 8A built + cherry-picked (`396d50b`): existing-domains-only (changes/domain-creation dropped), mining prompt rewrite, optional `id` match-signal on task/artifact entries, both-provider structured output intact. Verified offline (models/schema/imports + OpenAI strict + matched/new validate). **G1 (prompt+schema approval) + G2 (structured-output audit) pending — Omer/ai-engineer** |
| 9 | Not Started | 0/1 | 0/1 | 4/4 | Report engine — team-scoped context + id-based save + new-in-preview (one agent owns `reports/engine.py`). Builds against Wave 8's approved schema |
| 10 | Not Started | 0/1 | 0/1 | 3/3 | Report editor (frontend) — JIRA-style links (matched id → chip), team-scoped `@`/`#` picker, NEW label for unmatched. Consumes Wave 9 |
| 11 | Not Started | 0/1 | 0/1 | 3/3 | Search bar + DSL on domain/team/champion pages — 11A explore+design; then implement (11B+). See `task_breakdown.md` Wave 11 |

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
| 1 | Simplify report — existing domains only (+General); drop domain create + per-domain `changes` (priority/description) | 🟢 Done | `ReportDomainChanges` removed; section now `{domain,tasks,artifacts}`; schema twin matches |
| 2 | Rewrite `_SYSTEM_PROMPT` to MINE every supported category + free-text inference (single-shot) | 🟢 Done | mining framing; champion/date-resolution/verbatim raw_notes kept; no-invent + General + grouping + completeness preserved |
| 3 | Per-entity matching: `{id,name}` if matched else `{name,(type),suggested fields}` | 🟢 Done | optional `id` on task+artifact entries; matched→id+exact name (artifact+type), no-match/"new"→no id+suggested |
| 4 | Structured output for BOTH providers (OpenAI response_format + Anthropic tool), validated | 🟢 Done | both paths derive from `ReportDocument`; OpenAI strict puts `id` in required-nullable; matched/new validate |

### Wave 8 gates — Omer authorization (orchestrator-run; not parallel agents)
| # | Gate | Status | Notes |
|---|------|--------|-------|
| G1 | Omer reviews & approves rewritten prompt + simplified `ReportDocument` schema (verbatim) before Wave 9 | ⬜ Pending | like the domains review |
| G2 | `ai-engineer` confirms both providers' structured outputs (each its own form) implemented + validated; Omer signs off | ⬜ Pending | same audit as domain extraction |

---

## Wave 9 — Report engine: team-scoped context + id-based save (1 agent)

> Builds against Wave 8's approved schema/prompt. One agent — owns `reports/engine.py` (context + save), can't be split on the same file. See `task_breakdown.md` Wave 9.

### Agent 9A: Team-scoped context + id-based save + new-in-preview (`reports/engine.py`, `routes/reports.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team-scoped context — `build_draft_context` passes only the team's tasks/artifacts (full fields + id) | ⬜ Pending | scoped to team, not champion |
| 2 | Trim domain baggage from context (existing domain names only) | ⬜ Pending | aligns with simplified schema |
| 3 | Matched entry → resolve by `id` to that exact row (no fuzzy, no duplicate) | ⬜ Pending | ids globally unique PKs |
| 4 | New/unmarked entry → shown as NEW in preview; Omer accepts/edits/rejects (Q2) | ⬜ Pending | not auto-created silently |

---

## Wave 10 — Report editor: JIRA-style links + team-scoped @/# mentions + NEW markers (frontend)

> Consumes Wave 9's id-returning draft. See `task_breakdown.md` Wave 10.

### Agent 10A: JIRA-style entity links + team-scoped mention picker + NEW markers (`pages/report/*`, `api.ts`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Render matched entries (with `id`) as JIRA-style linked chips in preview/edit | ⬜ Pending | depends on Wave 9 id output |
| 2 | `@`/`#` opens a team-scoped list of tasks/artifacts; select links by id | ⬜ Pending | reworks Wave-3C global mentions |
| 3 | Mark NEW (unmatched) tasks/artifacts with a clear "NEW" label/badge | ⬜ Pending | visual = frontend agent's call (badge/label/grouped list) |

---

## Wave 11 — Search bar + DSL on entity pages (design first, then implement)

> Opens with a design/exploration task (11A → `specs/search_integration.md`); implementation (11B+) is scoped from the approved spec. See `task_breakdown.md` Wave 11.

### Agent 11A: Explore + design SearchBar/DSL integration (spec only — `specs/search_integration.md`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Map where SearchBar + DSL belongs (domain/team/champion pages + grouped Manage lists; in/out per page) | ⬜ Pending | ground in the Wave-3 search module |
| 2 | Define the DSL keys per surface (reuse team/domain/type/tag/status/date; flag any new key + backend support) | ⬜ Pending | no invented backend |
| 3 | Decide grouped-view filtering (filter within team groups? collapse empties?) | ⬜ Pending | resolve with Omer |
