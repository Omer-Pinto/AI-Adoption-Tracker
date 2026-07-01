# QA Run — Summary (all 3 teams, 10 reports, live OpenAI drafts)

Run by Claude as QA agent, 2026-07-01, on :5173 (backend :8000, real `.env` OpenAI key). Method: live `POST /api/reports/draft` (1-1 with the UI Create-Report → Draft) diffed against each report md's expected output; corrected + saved each report so cross-week matching held. Setup (3 teams + smart-domain-extract) done via the same endpoints the UI uses.

## Setup — ✅ clean
- 3 teams created (Payments/Maya, Web/Noa, Data/Sven). Smart-domain-extract **priority arrow-mapping correct** for all 3 (Payments `1→2→4→3` ⇒ Observability=3, Infrastructure=4 — the non-trivial case). Constant domains (General/Context Creation) auto-minted.

## A1+A2 — ✅ VERIFIED WORKING end-to-end
- **Action items = AI-Lead-only, no owner:** every AI-Lead line ("AI enablement lead to …") → action_items with the clean contract `{text, note, status, due_date}`; no owner/domain keys. Fan-out stamps **team_id** (team shown, no owner) and the **cross-team AI-Lead worklist** spans all 3 teams.
- **Champion follow-ups → tasks (D2 fold):** "Maya to…/Noa to…/Sven to…" lines became **tasks** (owner = champion), never action items. Where a completion was later mentioned, it **id-matched the task** (Web R3 training→finished, Data R2 doc→in-progress) — the annotated A1+A2 flip. (One miss: Payments R2 how-to-doc completion — name too dissimilar to match; see below.)
- **Owners shown in draft (D8/D5):** all task owners resolved in the DRAFT (no blank "— owner —"); different-person owners kept (Tomer, Lior).
- **Team-tag, gutter, board:** action items team-tagged from the report; General gutter available.

## D items — results (probabilistic, now observed live)
- **D1 no-drop — ✅** "Rewrite the ledger in Rust" / "Rebuild ingestion in Flink" (rejected ideas) → captured as `wont_fix` tasks, not dropped.
- **D3 change_kind — ✅** always set (added/updated) on every artifact.
- **D5 owners — ✅** Tomer / Lior captured as different-person owners.
- **D6 names/summaries — ✅** "Secrets pre-commit hook" (not generic), descriptive summaries present.
- **D7 issues vs discussion — mostly ✅** slippage/gaps→issues; one borderline (Payments R1 "marketplace adoption low" → issues, expected discussion).
- Matching / continuity — ✅ cross-week id-matching, sticky due_dates, terminal statuses, and the **team-wide a11y cross-week continuity (headline test): PASS** (1 artifact, 3 history rows, stays null).

## ⚠️ NEW real LLM findings (were not in round-1, which only covered Payments)
1. **Over-inclusion (HIGH, 2 occurrences: Web R2, Data R3).** The model re-emits PRIOR entities that are only mentioned/referenced (not changed) in the current notes — re-listing prior tasks/artifacts and writing spurious history rows. Hypothesis: the "Multi-week tasks:" header and any name-drop of an existing entity triggers re-emission. Corrected each time before save.
2. **"Action items / notes" lines misrouted to discussion (MED, Payments R1 & R2).** Statement-form lines ("The how-to doc is done", "We decided NOT to push org-wide", artifact restatements) were dumped into `discussion` instead of task-update / AI-Lead action item. Explicit "X to do Y" phrasing routes correctly; statement/decision phrasing under-routes.
3. **Duplicate/over-capture into discussion/issues (LOW).** Already-structured facts restated (Payments R1 artifacts→discussion; Data R2 blocked-task reason→issues).
4. **Context-file placement inconsistency (LOW).** Web R2 mobile-context → Mobile once (expected Context Creation); every other context file → Context Creation.
5. **Match sensitivity to name distance (MED).** Payments R2 "gRPC how-to doc is done" failed to match "Write a short how-to doc for the gRPC scaffold skill" task; closer names (accessibility training) matched fine.

## ❗ DESIGN QUESTION for Omer (not a bug) — A4 artifact placement
The model sends Claude tooling (skill/agent/hook/context) to **Context Creation** UNLESS the notes signal team-wide ("not tied to one area" → a11y stayed **null**). Consequence: **the qa report-md expected tech-domains for artifacts (Payments Core / Infrastructure / Transformation / Design System) are STALE per A4** — every non-team-wide artifact now lands in Context Creation. This is design-correct per your A4 decision, but it means artifact "domain" is nearly always Context Creation-or-null. **Confirm this is intended**, or refine A4's scope for artifacts.

## Saved state (for the UI walkthrough)
Payments: 3 reports · 7 tasks (2 open/5 closed) · 4 artifacts. Web: 4 reports · 7 tasks (3/4) · 4 artifacts. Data: 3 reports · 5 tasks (2/3) · 4 artifacts. Cross-team AI-Lead worklist populated.
