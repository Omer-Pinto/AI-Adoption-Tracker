# AI Adoption Tracker — Progress Tracker

> **Last updated:** 2026-06-18 | **Branch:** `mvp-spec`

## Summary

```
Progress: [🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢⬜⬜⬜⬜⬜⬜⬜⬜⬜] 65% (30/46)
```

| Status | Count | % |
|--------|-------|---|
| 🟢 Done | 30 / 46 | 65% |
| 🔵 In Progress | 0 | 0% |
| ⬜ Pending | 16 | 35% |

---

## Wave Status

| Wave | Status | Agents | Cherry-picked | Pending | Notes |
|------|--------|--------|---------------|---------|-------|
| 0 | Done | 2/2 | 2/2 | 0/6 | Setup complete — foundation merged, verified (schema applies, backend boots, frontend builds) |
| 1 | Done | 4/4 | 4/4 | 0/14 | Backend merged + verified (18 routes; report fan-out/replay reads back; q-DSL + autocomplete live) |
| 2 | Done | 3/3 | 3/3 | 0/10 | Merged + verified (air-gapped LLM adapter; report-engine corrections; backend fixes). Post-review fixes: LIKE ESCAPE single-char, prefill-echo tolerance, per-domain replay reset |
| 3 | Not Started | 0/4 | 0/4 | 12/12 | Frontend (manage, team/domain, report flow + @/# mentions, artifacts/tasks+search) |
| 4 | Not Started | 0/1 | 0/1 | 3/3 | Integration, seed, smoke, docs |
| 5 | Not Started | — | — | 1/1 | Decisions sign-off — resolve all open items in decisions.md |

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
| 1 | Lists (teams/champions/domains, Add/Edit) | ⬜ Pending | |
| 2 | Isolated edit modal form | ⬜ Pending | |

### Agent 3B: Team & Domain pages (`pages/team/`, `pages/domain/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team page (portfolio + story + gutter + create report) | ⬜ Pending | |
| 2 | Domain page (current + full story) | ⬜ Pending | |
| 3 | Artifact detail modal usage | ⬜ Pending | |

### Agent 3C: Report flow UI (`pages/report/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create (notes → draft) | ⬜ Pending | |
| 2 | Preview → confirm | ⬜ Pending | |
| 3 | Edit saved report | ⬜ Pending | |
| 4 | `@` task / `#` artifact mentions (fuzzy, all items, Jira-style; pick existing or type new) | ⬜ Pending | |

### Agent 3D: Artifacts, Tasks & Search bar (`pages/artifacts/`, `pages/tasks/`, `search/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Adapt chip search bar to React (autocomplete, URL round-trip) | ⬜ Pending | |
| 2 | Artifacts page (filtered, modal) | ⬜ Pending | |
| 3 | Tasks page (filtered, week-by-week expand) | ⬜ Pending | |

---

## Wave 4 — Integration & seed

### Agent 4A: Seed + smoke (`seed.py`, `scripts/`, `README.md`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Seed script (via the report engine path) | ⬜ Pending | |
| 2 | Run command + README (model-endpoint env var) | ⬜ Pending | |
| 3 | Smoke pass (create→appears everywhere; search; modal; edit+replay) | ⬜ Pending | |

---

## Wave 5 — Decisions sign-off (gate)

### Gate: resolve open decisions (orchestrator + Omer)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Every item in `specs/decisions.md` closed — nothing left TBD | ⬜ Pending | |
