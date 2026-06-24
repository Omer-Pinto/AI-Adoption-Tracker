# AI Adoption Tracker — project guide (handoff)

Tracks a team's Claude Code adoption over time. A **champion** meets periodically; raw meeting
notes → LLM → a structured weekly **report** → fanned out to current-state + history tables
(tasks, artifacts, domains, action items). Branch **`mvp-spec`** (noisy WIP, **not merged to
master** — direct WIP commits are fine).

**Authoritative handoff = this file + `specs/progress.md` (status) + `specs/task_breakdown.md`
(plan).** Read all three to pick up. `specs/spec.md` is the original spec but is partly stale
(domain `scope`/`cross_domain`-as-text were removed — see Domain model below).

## Stack / run
- **Backend:** SQLite + FastAPI in `src/backend/`. Run: `cd src/backend && uvicorn app:app --host 127.0.0.1 --port 8000` with the 4 `TRACKER_LLM_*` vars exported from `.env` (gitignored; OpenAI / gpt-4o configured, no endpoint URL = hosted default).
- **Frontend:** React/Vite/TS in `src/frontend/`. Run: `npm run dev` → http://localhost:5173 (HMR; proxies `/api` → :8000).
- DB is recreated from `src/backend/schema.sql` on startup. `db.py` hardcodes `tracker.db`.
- LLM adapter: official **OpenAI/Anthropic SDKs + Pydantic structured outputs** in `src/backend/llm/interface.py` (`draft_report`, `extract_domains`). No hand-rolled JSON-schema, no urllib.

## HARD RULES — do not break
- **NEVER wipe or mutate the user's `src/backend/tracker.db`.** Teams/champions/CC-baselines/domains are entered by hand; wiping destroys his work. For tests: `cp` it to a temp path or build a throwaway from `schema.sql`, test there, delete **your** temp DB only.
- **Post-stabilization work goes in git worktrees** (per-task isolation + cherry-pick), not the main tree.
- **Do not push Wave 6** — we are far from it.
- Reproduce a bug before fixing; verify changes live against the running app; be terse; never claim done without evidence.

## Domain model (current, agreed with Omer)
- **Domains = a team's tech/stack areas, created manually** — in Manage, or via the **text→domains LLM extraction** (`POST /api/domains/extract`). The report model NEVER invents domains; "Claude Code"/meeting-headings are never domains. A per-champion **"General"** catch-all holds items the model can't place.
- **Tasks & artifacts = report-driven.** The draft model references EXISTING ones (fed via DB context) by exact name and creates new only when the notes say "new …". The UI is the **fix-handle** (per-item domain picker; `@`-task / `#`-artifact mentions).
- Domain fields: `name`, `description`, **`priority` (free TEXT)**, **`cross_domains`** = symmetric links across ALL teams, shown "Team: Domain" (`domain_link` table). **No `scope`** (removed everywhere).
- `team.cc_baseline` = the team's "Current Claude Code status" (skills, agents, claude.md/context files, workflows).

## Status
Waves 0–5 done. **Wave 5.5 stabilization** mostly done + live-verified; the domain redesign
(extraction + symmetric links + scope removal) is built (5.5G). **Open: 5.5H** — consolidate the
two confusing domain-add buttons into one "Add Domain(s)" box (manual single + LLM multi) and fix
the modal-vs-separate-page inconsistency. **Wave 6** (extraction depth) is NOT started and far off.
