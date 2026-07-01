# Bug list — base for the bug-fix effort (QA Round 1)

> Source: Omer's QA Round 1 (Maya / Payments, reports May 4 / 11 / 18 + global UI). 33 raw points,
> captured 1-1, deduped into themes (every occurrence cited). **Assessment only — nothing fixed.**
> This file is the working base (cheaper than inserting 33 points into a wave).
>
> Tags: **[bug]** deterministic code · **[ui]** layout/polish · **[llm]** extraction-quality (prompt,
> probabilistic) · **[product]** needs a decision · **[ok]** confirmed not-a-bug.
>
> Status notes (Omer): **A1–A4 can wait** (deferred, not dropped). **Section E not fully agreed —
> under review.** **B3 reclassified to D8** after code check (owner default is prompt-driven).

---

## A. Decisions to make FIRST (architectural — deferred per Omer, do not code until agreed)

### A1 + A2 — RESOLVED (Omer + analysis, 06-30). Build plan below. — **BUILT ✅ (07-01, `mvp-bug-fixes-prod`)**

> **Built + live-verified.** Parallel backend/frontend agents in worktrees, cherry-picked disjoint.
> Backend: `action_item` dropped `owner` + added `note` (pre-MVP — no migration; DB deleted and
> recreated clean from `schema.sql`, which is authoritative); AI-Lead worklist returns
> ALL items (no owner filter); PATCH/DELETE allowed on ANY item (report-derived 409s removed);
> replay skips action items (create-once); `PATCH /reports/{id}` → 409 on a non-latest report; prompt
> redefined (action items = AI-Lead-only, champion follow-ups → tasks — closes **D2**). Tests: 12
> pytest + 45 journal-harness green. Frontend: editor section relabeled "My action items (AI Lead)",
> Owner column removed + Note added (read-only in edit = create-once), team + AI-Lead boards do full
> in-place CRUD on all items with note+domain, non-latest reports render read-only (View only). FE
> build clean. Live-verified on :5173: edited a report-derived item's note end-to-end, latest-only
> edit gating, read-only older report.

> **Round-2 review fixes (07-01) — Omer QA of the build. ⚠️ FIXED-IN-CODE, NOT YET E2E-VERIFIED**
> (DB is empty pre-MVP; final proof is the real QA/LLM E2E pass that Claude runs after D). Ran the
> full gate this round: 2 agents in 2 worktrees → **code-reviewer** (0 FIX-NOW) → **code-simplifier**
> → cherry-picked. Items:
> - **b-place — action items are BOARD-ONLY** (Omer decision): removed from the **team page** entirely
>   (backend `TeamPage` no longer returns `action_items`/`open/closed_action_items`; FE drops the tile
>   + fold) and from the report **EDIT** flow (the "My action items (AI Lead)" section renders only in
>   the **create** flow; the read-only-in-edit variant + its plumbing were deleted). AI-Lead board is
>   the sole CRUD home. Resolves the "why per-team / why on team page / missing +Add in edit" confusion.
> - **b-focus — autofocus bug**: the "other owner" task input had a hardcoded `autoFocus` that stole
>   focus into a cell on report load (e.g. Payments report 3 → "Tomer"). Removed; popup/LinkPicker
>   autofocus kept (correct). *Verify in QA: opening/creating a report leaves focus on the page.*
> - **b-align — action-items editable table render (looked "like CRAP")**: rebalanced the `ai-table`
>   `<colgroup>` widths + CSS so inputs align under STATUS/DUE/DOMAIN/NOTE and the status pill stops
>   clipping. ⚠️ **Not visually verifiable on an empty DB** — needs eyes on a populated create-report
>   editor during QA; small residual risk the status column needs a few px more.
> **Round-3 (07-01) — Omer decisions on the two open questions. ⚠️ FIXED-IN-CODE, NOT YET E2E-VERIFIED.**
> Same full gate (2 agents / 2 worktrees → code-reviewer (1 FIX-NOW, fixed) → code-simplifier → cherry-pick):
> - **(a) Action items carry a TEAM, not a domain.** `action_item.domain_id` DROPPED, `team_id`
>   (nullable FK team) ADDED. Report-derived → `team_id` = the report's team; manual (board) →
>   user picks a team or leaves the **"General"** gutter (null). Fully editable on the board anytime.
>   Removed the Domain column from the report-editor action-items card; `ReportActionItem` dropped
>   domain; worklist `team_name`/`champion_name` now resolve from `action_item.team_id` (not via the
>   report); board add/edit form got a Team `<select>` (null="General", else `/api/team-pages`);
>   prompt drops action-item domain. Review FIX-NOW: `AILeadActionItem` was missing `team_id` in the
>   response → fixed (live-smoked: create + worklist return team_id/team_name).
> - **(b) Dropped the per-item "Open report ↗" link** on the AI-Lead board.
> - Tests: 17 pytest + 46 journal-harness green; FE build clean; DB deleted+recreated from schema.sql
>   (`action_item` = id, report_id, team_id, text, note, due_date, status). *E2E/LLM QA still pending
>   (after D): domain→team on drafts, board team-picker + gutter, per-week champion follow-ups landing
>   as id-matched TASKS not fresh action-item rows (see qa/ ⚠️ annotations).*

**Agreed model:**
- **"Action item" = the AI Lead's own to-do, EXCLUSIVELY.** No owner (always the AI Lead). Created
  from the "AI Lead to…" lines in a report's notes, OR added standalone on the AI-Lead board. After
  creation: **full in-place CRUD** (status incl. abandon/wont_fix, text, due, **note**, delete) for
  ALL items — not just standalone. NOT journaled, NOT re-matched, NOT touched by replay.
- **Champions/team members have NO action items.** A "light" champion follow-up is a **task in the
  team's General** domain (use the gutter). If the notes describe a champion follow-up, it becomes a
  task (General if unplaced) — never an action item, never discussion.
- **Why the split (not LLM reliability):** tasks/artifacts change *at* meetings (reported → LLM
  extract/match is the core feature, kept). Action items change *between* meetings, by the AI Lead
  who doesn't file reports → no meeting event to carry the update → in-place CRUD.
- **#2:** tasks & artifacts stay event-sourced + replay — unchanged.
- **#3:** only the **latest** report per team is editable; the Edit affordance is **removed** from
  older reports (eliminated, not greyed).
- A report **creates** its action items once on save; replay/edit of the latest report re-folds
  tasks/artifacts but **does not touch** action items (in-place edits never clobbered).

**Build plan (under A1+A2):**
- **DB (`schema.sql` `action_item`):** DROP `owner`; ADD `note TEXT` (nullable). Keep `report_id`
  (nullable), `domain_id` (nullable), `text`, `due_date`, `status`.
- **Backend:** `models.ActionItem`/`ReportActionItem` drop `owner`, add `note`. `engine`:
  `_insert_action_item` stops writing owner (delete the action-item owner-default logic), writes
  `note`; **replay must skip action items** (create-once, independent). `routes/views.py`: AI-Lead
  worklist drops the `owner='AI Lead'` filter (every action item is the AI Lead's now); action-item
  **PATCH** allows text/status/due/note/domain on ANY item; **DELETE** allowed for ANY item (remove
  the report-derived 409). `PATCH /reports/{id}`: reject editing a non-latest report (#3).
- **Prompt (`llm/interface.py`):** redefine ACTION ITEMS = exclusively the AI-enablement-lead's own
  to-dos (no owner); a champion/team follow-up is a TASK (its tech domain, else General) — never an
  action item, never discussion. Remove all action-item owner rules. (Also fixes **D2**.) Task owner
  default = champion stays.
- **UI:** report editor action-items section — remove the Owner column/dropdown, add a **Note**
  field, keep status/due/domain (relabel → "My action items (AI Lead)"). Team page + AI-Lead board:
  in-place CRUD (status/text/due/note/delete) for ALL action items; show note + domain. Reports
  list/detail: remove the Edit button on non-latest reports (#3). `types.ts`/`api.ts`: `ActionItem`
  drop `owner`, add `note`; patch/delete for any item.
- **Migration (existing QA DB):** DECIDED (Omer 06-30) — **just drop `owner`**; existing action
  items all become AI-Lead items (no conversion to tasks). Omer re-enters/cleans QA fresh.
- **A3 — Kill manual single-domain add** *(global #2)* — **done ✅** manual "+ Add Domain" modal
  trigger removed; single **"+ Add Domains"** entry → the smart-extract page (single domain = one
  line). `DomainForm` kept for *editing*; `POST /api/domains` kept for the extract approve step.
- **A4 — Skill→domain placement** *(May 18 #3)* — **RESOLVED by design (Omer 06-30):** Context
  Creation is the home for ALL Claude tooling (skills/agents/hooks/context) **and** any
  task/action-item about *building* that tooling — it's domain-agnostic (e.g. an "FE-dev agent" →
  Context Creation, NOT the FE domain). Tech domains hold actual product/feature work (FE = "add
  reports page + API + tests"). So skills→Context Creation is correct, not a bug. **Prompt
  tightened ✅** to enforce it (Context Creation = all Claude tooling; "team-wide skills" removed
  from the null bucket). NOTE: this means team-wide skills now land in Context Creation instead of
  the team-wide/null gutter — the qa Web-Experience a11y-skill expectation shifts accordingly.

## B. Deterministic code bugs (no LLM involved) — done ✅

- **B1** `[bug]` Team-page Open/Closed-tasks tiles open a "weird empty domain"; should open dedicated
  Open/Closed Tasks sections (tasks standalone + under domain, like artifacts) *(May 4 #12e)*. **High.**
- **B2** `[bug]` Action-item domain not shown in team UI (only in edit-report) *(May 4 #13)*. **Med-high.**
- **B3** → **moved to D8** (owner default is prompt-driven, not deterministic). Kept here as a pointer
  so nothing is lost.
- **B4** `[bug]` Default participants missing "AI Lead" *(May 4 #1)*. **Med.**
- **B5** `[bug][ui]` Textbox-growth distorts layout — action-item text & owner-"other" expand the
  cell and shove other columns/rows *(May 4 #7 & #10, May 11 #4 — same root)*. **Med, ugly.**
- **B6** `[ui]` Inputs not aligned to column headers *(May 4 #3)*; action-item textbox bigger/unaligned
  vs task/artifact — match their design *(May 4 #7)*. **Low-med.**

## C. UI polish — done ✅

- **C1** `[ui]` AI-Lead board tiles too narrow → "planned · in progress · blocked" wraps to 2 lines;
  widen *(global #6)*.
- **C2** `[ui]` Remove the circles on the AI-Lead sidebar nav item (purple+red) — dirty *(May 4 #11)*.
- **C3** `[ui][product]` Dashboard card subtext is redundant, remove/blank *(global #4)* — confirm
  with product-manager agent.
- **C4** `[ui]` Smart-extract results: make each translated domain foldable to kill the long scroll
  (check → fold → next visible without scrolling) *(global #3)*.
- **C5** `[ui]` "4 + 2 constants" — "constants" renders on a lower level; put it inline *(global #5)*.
- **C6** `[ui]` Rename "meetings" tile/section text so the tile label matches the section it opens
  *(May 4 #12b)*. *(#12 a/c/d already work correctly.)*

## D. LLM extraction-quality (prompt fixes — probabilistic; one pass covers several) — **BUILT ✅ (07-01, `mvp-bug-fixes-prod`). ⚠️ NOT YET LIVE-VERIFIED (probabilistic — needs the live LLM QA that Claude runs next).**

> **One coherent pass by an ai-engineer agent** (Omer's call — the LLM contract must be owned by an
> LLM specialist, since python-agent/hand edits to the structured-output pydantic objects were the
> risk). Full gate: ai-engineer → code-reviewer (2 FIX-NOW: draft-preview vs save divergences — a
> matched-artifact domain silently stripped on save, and a cleared-vs-never-owned owner mismatch —
> both fixed by reusing the exact save-path functions) → re-review (clean) → simplifier → cherry-pick.
> - **Contract CURATED:** audited `ReportDocument` + sub-models; confirmed `ReportActionItem` is
>   `{text, note, status, due_date}` only (no owner/domain/team). Added tests proving BOTH provider
>   derivations clear — OpenAI-strict (`to_strict_json_schema`: all-required + nullable + additional
>   Properties:false) AND Anthropic (`model_json_schema()`), from the same code paths interface.py uses.
> - **D1** no-drop safety net (rejected ideas → `wont_fix` tasks + final line-by-line check).
> - **D3** `change_kind` always set (draft-time default mirroring save's inference + prompt).
> - **D4** DECISION: KEEP `note`, tightened to a per-meeting CHANGE DELTA only (never restate name/
>   status/owner/summary; null when nothing changed) — it backs `task_history`/`artifact_history.change_note`.
> - **D5** task owner emitted when the notes name a person.
> - **D6** strong artifact names + always a real `summary`.
> - **D7** problems/risks/slippage → `issues`, not discussion.
> - **D8** APPROACH: deterministic **draft-time defaulting** in `routes/reports.py` (`apply_draft_defaults`,
>   reusing `_task_journal_has_owner` / change-kind inference) so the preview owner/change_kind == what
>   SAVE persists — the LLM can't forget, and a matched task's real owner isn't clobbered. No owner on
>   action items. Tests: 31 pytest + 46 harness + 14 contract/draft-default green.
> - **Live QA still owed (Claude, after this):** the probabilistic behaviors above against all 3 teams'
>   reports (real OpenAI + Anthropic drafts) — confirm no-drop, change_kind, note-discipline, owners,
>   names/summaries, issues-routing, and preview==saved.

- **D1** `[llm]` Dropped a whole task: "Rewrite the ledger in Rust" vanished entirely *(May 18 #1)* —
  no-drop safety-net failed. **High.**
- **D2** `[llm]` Action items mis-routed to `discussion` with no owner (100% miss that week)
  *(May 11 #7)*. **High. → FOLDED INTO A1+A2** (the action-item prompt redefinition fixes this —
  don't handle separately).
- **D3** `[llm]` `change_kind` not set on artifacts: new gRPC skill missing "added"; skill update
  missing its change type *(May 4 #5, May 11 #5)*. **Med.**
- **D4** `[llm]` Notes overused — model dumps redundant restatements into `note` *(May 4 #4 "root
  cause unknown", May 11 #1/#2/#6, May 18 #2/#4)*. Omer questions `note` itself. **Med.**
- **D5** `[llm]` Owner not set on tasks the notes imply Maya owns *(May 18 #2)*. **Med.**
- **D6** `[llm]` Weak artifact names/summaries: hook named generic "pre-commit hook" instead of using
  the summary ("Blocks secrets sneaking into config files"); no summary for gRPC skill
  *(May 11 #6, May 4 #9)*. **Med.**
- **D7** `[llm]` discussion-vs-issues: "On-call fatigue creeping up" landed in discussion, expected
  issues *(May 4 #8)*. **Low (judgment call).**
- **D8** `[llm]` Task owner dropdown shows blank in preview *(May 4 #2 — reclassified from B3)*: the
  prompt tells the model to leave `owner` null and the backend fills the champion only on save, so
  the editor shows "— owner —". Fix in the prompt (emit champion) or default at draft time.
  Related to D5. **Med.**

## E. Confirmed NOT a bug / expected — done ✅

- **E1** `[ok]` how-to doc for gRPC skill → Context Creation: correct *(May 4 #6)*.
- **E2** `[ok]` "overdue" only renders after save *(May 11 #3)* — computed on saved data.
- **E3** `[ok]` Tomer "other" owner worked *(May 11 #4)* — only the textbox sizing (B5) is the issue.
- **E4** `[ok]` Matching worked well May 11 (task+status+domain+owner) *(May 11 #2)* — positive.
- **E5** `[ok]` Action-item text carrying "AI enablement lead to present…" vs owner=AI Lead
  *(May 18 #5)* — flagged too-minor.

## F. Trivial copy/data — done ✅

- **F1** `[bug]` "Context creation" → "Context Creation" *(global #1)* — seeded constant-domain name,
  so a small code+data change, not just CSS. **Extended:** the constants were also identical across
  every team (N bare "General"/"Context creation" rows polluting the search list), so they are now
  **per-team prefixed** — `"{Team}'s General"` / `"{Team}'s Context Creation"` — with all
  constant-detection switched to suffix matching and existing DB rows renamed in place.

---

## Coverage
All 33 raw points represented (A:4 · B:5+ptr · C:6 · D:8 · E:5 · F:1; B5/D3/D4 each fold multiple
occurrences; B3→D8). Suggested order once A1–A4 are decided: B → D → C/F.
