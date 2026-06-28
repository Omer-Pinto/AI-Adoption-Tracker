# Handoff → Wave 16 (One champion per team — 1:1 refactor)

**To my successor.** Execute **Wave 16** on branch **`mvp-refactor-champs`** (already cut off `mvp-improvements`, which is where the merged work lives).

## What to read first
- **`CLAUDE.md`** — the project guide + HARD RULES, and the **wave → worktrees → agents** method (Omer's triplet: `wave-planner` / `wave-executor` / `parallel-wave-executor`). Build happens in agents in git worktrees, cherry-picked back — the orchestrator never writes feature code.
- **`specs/progress.md`** — status (single source of truth for what's done/next). Wave table reads: 15 done → **16 = NEXT** → 17 (go-live, deferred) → 18 (search, deferred).
- **`specs/task_breakdown.md` → Wave 16** — the full plan: design, 5 locked decisions, phases, per-agent disjoint file sets, risks.

## What Wave 16 is
Collapse team↔champion to **exactly ONE champion per team**: fold the champion **into the team** (`team.champion_name NOT NULL` + `champion_start_date`; drop the `champion` table), key everything by `team_id`, team page `/teams/:teamId`, remove the report champion-picker. **Locked decisions:** champion_name NOT NULL · nuke dead `cc_baseline`/`baseline_date` · team-chooser fallback for context-less report-create · **recreate DB clean** (Omer re-enters QA) · **team + champion created TOGETHER** in one form (no standalone champion insertion).

## How to run it
Via **`parallel-wave-executor`, phase by phase** (each phase = a wave of parallel agents on disjoint files):
1. **16.A contract gate** (`api-designer`) → **Omer signs off the frozen contract before 16.B.**
2. **16.B** backend core (`python-pro`) + backend routes (`backend-developer`) + FE foundation (`frontend-developer`) — 3 parallel, disjoint. `ai-engineer` gate on the engine/prompt diff after 16B-1.
3. **16.C** nav/hub + manage + report/domain — 3 parallel, disjoint.
4. **16.D** expunge+recreate DB clean (authorized, this DB only) + fix `qa/` dataset (Web-Experience 2→1 champion) + live integration verify (incl. *rename champion → history shows new name*).
Update `progress.md` as you go. Use **Opus** for every agent. Keep `localhost:5173`/`:8000` fresh yourself (uvicorn `--reload`, vite HMR) — never ask Omer to restart.

## Watch-outs (from the architect)
- The `/teams/:id` champion→team re-key must be atomic across ~8 links/5 files (16C-1 owns ALL nav links).
- DELETE the name-based `_resolve_champion_id`; resolve team by explicit `team_id` / `report.team_id` (else the duplicate-team bug returns).
- Consolidate the **triple** `_ensure_general_domain` into ONE team-keyed engine def (16B-1).
- HARD RULE still applies elsewhere; the clean DB wipe is the one authorized exception, scoped to 16.D.

After Wave 16: Wave 17 (go-live) and Wave 18 (search) become eligible.
