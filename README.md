# AI Adoption Tracker

A small, offline (air-gapped) web tool for an AI-enablement lead to track
how each team adopts Claude Code week by week. Weekly meetings with a team's
champion are turned into structured reports that record the full journey of
every domain, task, and artifact over time.

---

## Requirements

- Python 3.11+ with `fastapi` and `uvicorn` installed
- Node.js 18+ with `npm`

Install backend dependencies (from repo root):

```bash
pip install -e src/backend
```

Install frontend dependencies:

```bash
cd src/frontend && npm install
```

---

## Running the app

### Option A — one command (backend + frontend together)

```bash
./scripts/dev.sh
```

Press Ctrl-C to stop both processes.

### Option B — separately

Backend (runs on `http://127.0.0.1:8000`):

```bash
src/backend/run.sh
# or: cd src/backend && uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Frontend (runs on `http://localhost:5173`, proxies `/api` to the backend):

```bash
cd src/frontend && npm run dev
```

---

## Seeding sample data

To populate the database with the canonical sample from spec §6 (team Radar /
champion Dana / domain signal-processing, plus team Platform / champion Eli):

> Note: the Platform / Eli (ci-cd) data is illustrative breadth data to demonstrate multi-team seeding — it is NOT part of the spec §6 canonical trace (only Radar / Dana / signal-processing is canonical).

```bash
python src/backend/seed.py
```

The script targets a **fresh database** — it deletes `src/backend/tracker.db`
before running (controlled by the `SEED_RESET` env var; set `SEED_RESET=0` to
disable the reset). Run it before starting the app for the first time, or any
time you want to reset to the sample state.

---

## Model endpoint configuration (required for drafting reports)

Creating new reports requires a configured LLM endpoint. Editing saved reports
and all other features (management CRUD, team/domain pages, search, tasks,
artifacts) work without it.

Set the following four required variables (plus one optional) before starting
the backend. **`.env` is git-ignored — never commit it.**

> **`.env` is NOT auto-loaded.** The backend reads `os.environ` directly; you
> must export the variables yourself before starting uvicorn (see examples
> below).

```dotenv
TRACKER_LLM_PROVIDER=openai          # wire format: "openai" or "anthropic"
TRACKER_LLM_ENDPOINT=https://your-server/v1   # base URL of your air-gapped server
TRACKER_LLM_API_KEY=sk-...           # credential (Bearer / x-api-key)
TRACKER_LLM_MODEL=your-model-name    # model name as the server expects it
```

| Variable | Required | Description |
|---|---|---|
| `TRACKER_LLM_PROVIDER` | yes | `openai` (OpenAI-compatible chat/completions) or `anthropic` (Anthropic messages API) |
| `TRACKER_LLM_ENDPOINT` | yes | Full base URL of your air-gapped model server — no default |
| `TRACKER_LLM_API_KEY` | yes | API credential sent as `Authorization: Bearer …` (OpenAI) or `x-api-key` (Anthropic) |
| `TRACKER_LLM_MODEL` | yes | Model identifier as your server expects it |
| `TRACKER_LLM_TIMEOUT` | no | Request timeout in seconds (default: 120) |

If any required variable is missing, the draft endpoint (`POST /api/reports/draft`)
returns HTTP 503 with a clear message. The backend reads these from the process
environment — you must export them before starting uvicorn. Three equivalent
ways to do this:

```bash
# Option 1 — source the file (variables persist in the current shell session)
source .env && uvicorn app:app --reload --host 127.0.0.1 --port 8000

# Option 2 — one-liner (variables scoped to the single command)
env $(grep -v '^#' .env | xargs) src/backend/run.sh

# Option 3 — export each variable explicitly
export TRACKER_LLM_PROVIDER=openai
export TRACKER_LLM_ENDPOINT=https://your-server/v1
export TRACKER_LLM_API_KEY=sk-...
export TRACKER_LLM_MODEL=your-model-name
```

---

## Smoke test

After seeding and starting the backend, run:

```bash
python scripts/smoke.py
```

This verifies all read-back endpoints, §6 data correctness, search filters,
and the edit/replay path. API-level only — browser UI was verified separately.

---

## Project layout

```
src/
  backend/           FastAPI app (flat layout; run from this dir)
    app.py           Application entry point + router wiring
    db.py            SQLite connection helper
    models.py        Pydantic entity + report-document models
    schema.sql       SQLite schema (applied on startup, idempotent)
    seed.py          Sample data loader (canonical §6 trace)
    reports/         Fan-out + replay engine
    routes/          management · views · reports · search
    llm/             Air-gapped LLM adapter (OpenAI + Anthropic dialects)
    search/          DSL search parser/compiler (adapted from SoccerSmartBet)
  frontend/          Vite + React + TypeScript
    src/             Page components, API client, search bar
scripts/
  dev.sh             Start backend + frontend together
  smoke.py           API smoke test (run after seeding + booting)
specs/               Design spec, API contract, decisions, task breakdown
```
