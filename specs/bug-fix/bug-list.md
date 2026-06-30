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

### A1 + A2 — RESOLVED (Omer + analysis, 06-30). Build plan below.

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
- **Migration (existing QA DB):** dropping `owner` makes existing champion-owned action items
  owner-less (all become AI-Lead items). **OPEN:** leave them (re-test fresh) vs convert
  champion-owned ones into General tasks. *(lean: just drop — you're re-entering QA.)*
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

## D. LLM extraction-quality (prompt fixes — probabilistic; one pass covers several)

- **D1** `[llm]` Dropped a whole task: "Rewrite the ledger in Rust" vanished entirely *(May 18 #1)* —
  no-drop safety-net failed. **High.**
- **D2** `[llm]` Action items mis-routed to `discussion` with no owner (100% miss that week)
  *(May 11 #7)*. **High.**
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
