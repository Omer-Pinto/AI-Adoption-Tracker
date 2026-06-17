# AI Adoption Tracker — Progress Tracker

> **Last updated:** 2026-06-17 | **Branch:** `mvp-spec`

## Summary

```
Progress: [🟢🟢🟢🟢⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜] 18% (6/34)
```

| Status | Count | % |
|--------|-------|---|
| 🟢 Done | 6 / 34 | 18% |
| 🔵 In Progress | 0 | 0% |
| ⬜ Pending | 28 | 82% |

---

## Wave Status

| Wave | Status | Agents | Cherry-picked | Pending | Notes |
|------|--------|--------|---------------|---------|-------|
| 0 | Done | 2/2 | 2/2 | 0/6 | Setup complete — foundation merged, verified (schema applies, backend boots, frontend builds) |
| 1 | Not Started | 0/4 | 0/4 | 14/14 | Backend (management, views, report engine, search) |
| 2 | Not Started | 0/4 | 0/4 | 11/11 | Frontend (manage, team/domain, report flow, artifacts/tasks+search) |
| 3 | Not Started | 0/1 | 0/1 | 3/3 | Integration, seed, smoke, docs |

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
| 1 | Team CRUD | ⬜ Pending | |
| 2 | Champion CRUD | ⬜ Pending | |
| 3 | Domain CRUD | ⬜ Pending | |

### Agent 1B: Views & lists API (`routes/views.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team page aggregate (+ all-team gutter) | ⬜ Pending | |
| 2 | Domain page aggregate | ⬜ Pending | |
| 3 | Task list + detail (history) | ⬜ Pending | |
| 4 | Artifact list + detail (modal data) | ⬜ Pending | |

### Agent 1C: Report engine + LLM drafting (`reports/`, `routes/reports.py`, `llm/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Draft endpoint (notes → structured) | ⬜ Pending | |
| 2 | Confirm/save fan-out (transaction) | ⬜ Pending | |
| 3 | Edit + replay | ⬜ Pending | |
| 4 | LLM adapter impl (pluggable) | ⬜ Pending | |

### Agent 1D: Search DSL (`search/`, `routes/search.py`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Adapt parser/compiler to SQLite + our keys | ⬜ Pending | |
| 2 | Wire into tasks & artifacts list queries (`q` param) | ⬜ Pending | |
| 3 | Autocomplete value endpoints | ⬜ Pending | |

---

## Wave 2 — Frontend

### Agent 2A: Management UI (`pages/manage/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Lists (teams/champions/domains, Add/Edit) | ⬜ Pending | |
| 2 | Isolated edit modal form | ⬜ Pending | |

### Agent 2B: Team & Domain pages (`pages/team/`, `pages/domain/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Team page (portfolio + story + gutter + create report) | ⬜ Pending | |
| 2 | Domain page (current + full story) | ⬜ Pending | |
| 3 | Artifact detail modal usage | ⬜ Pending | |

### Agent 2C: Report flow UI (`pages/report/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create (notes → draft) | ⬜ Pending | |
| 2 | Preview → confirm | ⬜ Pending | |
| 3 | Edit saved report | ⬜ Pending | |

### Agent 2D: Artifacts, Tasks & Search bar (`pages/artifacts/`, `pages/tasks/`, `search/`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Adapt chip search bar to React (autocomplete, URL round-trip) | ⬜ Pending | |
| 2 | Artifacts page (filtered, modal) | ⬜ Pending | |
| 3 | Tasks page (filtered, week-by-week expand) | ⬜ Pending | |

---

## Wave 3 — Integration & seed

### Agent 3A: Seed + smoke (`seed.py`, `scripts/`, `README.md`)
| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Seed script (via the report engine path) | ⬜ Pending | |
| 2 | Run command + README (model-endpoint env var) | ⬜ Pending | |
| 3 | Smoke pass (create→appears everywhere; search; modal; edit+replay) | ⬜ Pending | |
