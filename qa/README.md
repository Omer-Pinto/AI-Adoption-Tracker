# Manual QA dataset — AI Adoption Tracker

A hand-built set of teams + domains + weekly meeting notes for **eyeballing** that the LLM
mining + fan-out engine behave correctly. You feed each report's `## NOTES TO PASTE` into
**Create Report**, draft, and compare the draft against that report's
`## EXPECTED STRUCTURED OUTPUT` (and the tasks/artifacts/domains/AI-Lead pages after saving).

Nothing here touches the DB directly — you create teams/champions by hand, insert domains via
**Smart domain extract**, and drive everything through the UI.

> **Today's date is assumed to be 2026-06-28** (matters for overdue vs future due-dates). All
> meeting dates are in May 2026, so May reports are in the past and June/July due-dates split
> into overdue (before 06-28) vs future (after 06-28).

## The 3 teams at a glance

| Team (folder) | Champion(s) | Stack flavor | Reports | Domains (via Smart-extract) |
|---|---|---|---|---|
| **Payments Platform** | `Maya` | Go/fintech backend | 3 | Payments Core, Risk & Fraud, Infrastructure, Observability |
| **Web Experience** | `Daniel` + `Rivka` (**multi-champion**) | React / React Native FE | 4 (2+2) | Daniel: Web Frontend, Design System · Rivka: Mobile, API Gateway |
| **Data Platform** | `Sven` | Spark/dbt data eng | 3 | Ingestion, Transformation, Data Quality |

**Total reports: 10** (within the 8–12 target; max 4 per champion).
Every champion also auto-gets **General** + **Context creation** (per-champion) — never add those.

## Setup steps (per team, once)
1. **Manually** create the team and its champion(s) in **Manage**.
2. **Smart domain extract**: paste the block from `<Team>/setup.md` (per champion for the
   multi-champion team) and accept the proposals. The setup files give the expected
   priority mapping (the `Priority Order:` arrow remaps over list positions — verify it).
3. Then feed reports in the order below.

## Exact feed order (global chronological)
Save each report before drafting the next one **for the same champion** (the LLM only sees
PRIOR-saved tasks/artifacts). Cross-team order is otherwise free, but this order also ensures
Daniel's team-wide a11y skill exists before Rivka references it:

| # | Date | Team | Champion | File |
|---|---|---|---|---|
| 1 | 2026-05-04 | Payments Platform | Maya | `Payments-Platform/reports/20260504.md` |
| 2 | 2026-05-06 | Web Experience | Daniel | `Web-Experience/reports/20260506-Daniel.md` |
| 3 | 2026-05-07 | Web Experience | Rivka | `Web-Experience/reports/20260507-Rivka.md` |
| 4 | 2026-05-08 | Data Platform | Sven | `Data-Platform/reports/20260508.md` |
| 5 | 2026-05-11 | Payments Platform | Maya | `Payments-Platform/reports/20260511.md` |
| 6 | 2026-05-13 | Web Experience | Daniel | `Web-Experience/reports/20260513-Daniel.md` |
| 7 | 2026-05-14 | Web Experience | Rivka | `Web-Experience/reports/20260514-Rivka.md` |
| 8 | 2026-05-15 | Data Platform | Sven | `Data-Platform/reports/20260515.md` |
| 9 | 2026-05-18 | Payments Platform | Maya | `Payments-Platform/reports/20260518.md` |
| 10 | 2026-05-22 | Data Platform | Sven | `Data-Platform/reports/20260522.md` |

## How matching/continuity works (so you know what to eyeball)
- **Tasks & artifacts are matched to existing rows by the LLM** (it gets prior entities with
  their ids). A week-2 mention of a week-1 task → an UPDATE of the same row (new status / due
  date), **not** a duplicate. An explicit **"new …"** forces a fresh row even when a similar
  name exists.
- **Domains are per-champion; tasks are per-champion; artifacts are TEAM-wide.** In the
  multi-champion team this means Daniel's tasks are invisible to Rivka, but a team-wide
  artifact Daniel creates IS visible to (and matchable by) Rivka. That is the headline trick.
- **`domain_id` null never invents a domain.** For a **task** it falls back to **General**;
  for an **artifact/action-item** it stays unplaced/team-wide.
- **Action items are per-report rows, NOT id-matched.** "Status change across weeks" = a fresh
  action-item row with the new status in the later report; the earlier row is untouched. Watch
  the AI-Lead view for whether re-mentions read as duplicates (flag if it bothers you).
- **Owner defaults**: a task with no named owner → the champion; a named different person (e.g.
  `Tomer`, `Lior`) is kept. Action-item owner is always either the champion's name or the
  literal **`AI Lead`** (the only two allowed values).

## Coverage matrix
Columns: **P**=Payments/Maya, **WD**=Web/Daniel, **WR**=Web/Rivka, **D**=Data/Sven. A cell
names the report date(s) that exercise the feature.

| Feature / vertical | P (Maya) | WD (Daniel) | WR (Rivka) | D (Sven) |
|---|---|---|---|---|
| Task — NEW | 05-04 | 05-06 | 05-07 | 05-08 |
| Task — matched/updated across weeks | 05-11/18 | 05-13 | 05-14 | 05-15/22 |
| `status` planned | 05-04 | 05-06 | 05-07 | 05-08 |
| `status` in-progress | 05-04 | 05-06 | 05-07 | 05-08 |
| `status` blocked | 05-04 | — | — | 05-15 |
| `status` finished_successfully | 05-11 | — | 05-14 | 05-22 |
| `status` finished_with_issues | 05-18 | 05-13 | — | 05-22 |
| `status` abandoned | 05-18 | — | 05-14 | — |
| `status` wont_fix (task) | 05-18 | — | — | 05-22 |
| due_date — none | 05-04 | 05-06 | 05-07 | 05-08 |
| due_date — future (after 06-28) | 05-18 (07-10) | 05-13 (07-15) | — | 05-08 (07-05) |
| due_date — past/overdue (before 06-28) | 05-11 (06-20) | 05-06 (06-15) | 05-07 (06-25) | 05-15 (06-10) |
| due_date — sticky (set in later week) | 05-11 fraud | 05-13 palette | — | 05-15 GE |
| Artifact type `agent` | — | 05-13 | — | 05-08 |
| Artifact type `skill` | 05-04 | 05-06 | — | — |
| Artifact type `hook` | 05-11 | — | — | 05-15 |
| Artifact type `context` | 05-04 | 05-06 | 05-07 | 05-08 |
| Artifact — NEW | 05-04 | 05-06 | 05-07 | 05-08 |
| Artifact — updated (matched) | 05-11 | 05-13 | 05-14 | 05-15 |
| Artifact grouping (md files → ONE context) | 05-04 | 05-06 | 05-07 | 05-08 |
| Team-wide artifact (no domain) | — | 05-06 a11y | 05-14 a11y | — |
| `@task` mention of existing | 05-11/18 | 05-13 | 05-14 | 05-15/22 |
| `#artifact` mention of existing | 05-11 | 05-13 | 05-14 | 05-15 |
| "new …" forces NEW despite similar name | 05-18 gRPC mock | — | 05-14 EAS* | 05-22 dbt test gen |
| Action item — owner = champion | 05-04 | 05-06 | 05-07 | 05-08 |
| Action item — owner = **AI Lead** | 05-04/11/18 | 05-06 | 05-14 | 05-08/22 |
| Action item — status change across weeks | 05-11 (finished/wont_fix) | 05-13 (finished) | — | 05-15 (in-progress) |
| Action item — with due_date | 05-18 | 05-06 | 05-07 | 05-08 |
| Action item — without due_date | 05-04 | 05-06 | — | 05-22 |
| Discussion (default catch-all) | 05-04/18 | 05-06 | 05-07 | 05-15/22 |
| Issues (problems/risks) | 05-04/18 | 05-13 | 05-07 | 05-08/22 |
| Placement → **General** (unplaceable) | 05-18 commit-format | — | — | 05-15 hiring |
| Placement → **Context creation** | 05-04 | 05-06 | 05-07 | 05-08 |
| Multiple domains in one report | 05-04 | 05-06 | 05-07 | 05-08 |
| Default owner → champion | 05-04 | 05-06 | 05-07 | 05-08 |
| Task owner = different named person | 05-11 Tomer | — | — | 05-08 Lior |
| Multi-champion team | — | ✓ | ✓ | — |
| Per-champion constant domains (2× General/Context) | — | ✓ | ✓ | — |
| Cross-champion team-wide artifact continuity | — | creates | matches 05-14 | — |
| Smart-extract + Priority-Order arrow mapping | setup | setup | setup | setup |

\* The Rivka 05-14 "new EAS task" exercises the explicit "new …" convention even though no
similar task pre-exists; the *similar-name* collision cases are P 05-18 (gRPC mock vs scaffold)
and D 05-22 (dbt test gen vs reviewer).

## Uncertainties / assumptions (flag while eyeballing)
1. **General placement is a judgment call.** The "commit-message format" (P 05-18) and "Q3
   hiring" (D 05-15) tasks are *meant* to land in **General** (null domain → task fallback).
   A capable model might over-reach and file them under Infrastructure / a tech domain, or it
   might emit them as discussion rather than tasks. Both are plausible — verify and note.
2. **Action items are not deduplicated.** Re-mentioning a follow-up in a later week creates a
   second `action_item` row. The "status change across weeks" rows (P 05-11, WD 05-13, D 05-15)
   will appear as NEW rows, not edits. If the AI-Lead cross-team list looks cluttered with
   near-duplicates, that's the current design — flag if undesirable.
3. **Cross-champion artifact match (WR 05-14 a11y lint)** depends on the model actually using
   the team-wide artifact from the draft context. If it instead creates a duplicate skill or
   moves it into Mobile, that's a real bug to catch.
4. **Type inference notes.** Where the notes don't state an artifact type explicitly (most of
   them name it: "skill"/"agent"/"hook"/"context"), the model should still set a best-fit type
   and may add a "type inferred as …" note. The expected types listed are the intended ones.
5. **meeting_date year resolution.** Notes give month-day only ("May 4th"); the model should
   resolve the year to 2026 (latest year ≤ today). If it picks a different year, that's a bug.
6. **`@`/`#` mentions** in these notes are written as plain phrases ("the idempotency work",
   "the a11y lint skill"), not literal `@`/`#` tokens — matching is meaning-based per the
   prompt. The literal `@`/`#` trigger is a UI editor affordance, exercised when you hand-edit
   a draft.
7. **Discussion vs issues split** is the model's call; a few lines (e.g. SEO/cost remarks)
   could land on either side. The expected sections show the intended bucket.
