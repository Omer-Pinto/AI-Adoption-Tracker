# AI Adoption Tracker — project guide

Tracks a team's Claude Code adoption over time. A **champion** meets periodically; raw meeting
notes → LLM → a structured weekly **report** → fanned out to current-state + history tables
(tasks, artifacts, domains, action items). Branch **`mvp-refactor-champs`** (WIP, not merged to
master — direct WIP commits are fine).

**For current status & plan, read `specs/progress.md` (status) and `specs/task_breakdown.md`
(plan).** Those are the single source of truth for what's done / next — this file holds only
durable context. `specs/spec.md` is the original spec (partly superseded — see Domain model).

## Stack / run
- **Backend:** SQLite + FastAPI in `src/backend/`. Run: `cd src/backend && uvicorn app:app --host 127.0.0.1 --port 8000` with the 4 `TRACKER_LLM_*` vars exported from `.env` (gitignored; OpenAI/gpt-4o, no endpoint URL = hosted default).
- **Frontend:** React/Vite/TS in `src/frontend/`. Run: `npm run dev` → http://localhost:5173 (HMR; proxies `/api` → :8000).
- DB recreated from `src/backend/schema.sql` on startup; `db.py` hardcodes `tracker.db`.
- LLM adapter: official **OpenAI/Anthropic SDKs + Pydantic structured outputs** in `src/backend/llm/interface.py` (`draft_report`, `extract_domains`). No hand-rolled JSON-schema, no urllib.

## Workflow — wave → worktrees → agents
Execution uses Omer's **triplet wave skill set**: **`wave-planner`** breaks a plan into
parallelizable agent waves (writing `specs/task_breakdown.md` + `specs/progress.md`),
**`wave-executor`** runs the next pending task, and **`parallel-wave-executor`** fans a wave out
across sub-agents in **git worktrees** (map-reduce) and cherry-picks the results back. Build work
is done **in worktrees by agents**, not edited directly in the main tree.

## HARD RULES — do not break
- **NEVER wipe or mutate the user's `src/backend/tracker.db`.** Teams (each with its one champion) and domains are entered by hand; wiping destroys his work. For tests: `cp` it to a temp path or build a throwaway from `schema.sql`, test there, delete **your** temp DB only.
- Reproduce a bug before fixing; verify changes live against the running app; be terse; never claim done without evidence.

## Domain model (current, agreed)
- **Domains = a team's tech/stack areas, created manually** — in Manage, or via the **text→domains LLM extraction** (`POST /api/domains/extract`). The report model NEVER invents domains; "Claude Code"/meeting-headings are never domains. A per-team **"General"** catch-all holds items the model can't place.
- **Tasks & artifacts = report-driven.** The draft model references EXISTING ones (fed via DB context) by exact name and creates new only when the notes say "new …". The UI is the **fix-handle** (per-item domain picker; `@`-task / `#`-artifact mentions).
- Domain fields: `name`, `description`, **`priority` (free TEXT)**, **`cross_domains`** = symmetric links across ALL teams, shown "Team: Domain" (`domain_link` table). **No `scope`** (removed everywhere).
- **One champion per team (1:1).** The champion is stored inline on the team (`team.champion_name` NOT NULL + `champion_start_date`); there is no standalone champion entity. Team + champion are created/edited together; everything keys by `team_id`.
