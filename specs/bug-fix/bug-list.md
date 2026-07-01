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

### A1 + A2 — DONE ✅ (built + live-verified across all 3 QA teams, 07-01)

Action items = the **AI Lead's own to-dos, only** — no owner. Tagged to a **team** (`team_id`,
nullable = the General gutter), NOT a domain. Created once from a report's "AI Lead to…" lines or
added standalone; not journaled, not re-matched, not touched by replay. **Full CRUD on the AI-Lead
board only** (removed from team pages and from the report-edit flow). Champion/team follow-ups become
**tasks** (General if unplaced), never action items. Only the **latest** report per team is editable.
`action_item` = (id, report_id, team_id, text, note, due_date, status).


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

- **A3 — Kill manual single-domain add** *(global #2)* — **done ✅** manual "+ Add Domain" modal
  trigger removed; single **"+ Add Domains"** entry → the smart-extract page (single domain = one
  line). `DomainForm` kept for *editing*; `POST /api/domains` kept for the extract approve step.
- **A4 — Artifact / tooling → domain placement** — **REVISED (Omer 07-01), reversing the earlier
  "all tooling → Context Creation" rule.** An **artifact ALWAYS has a team domain** (never team-wide/
  null): a skill/agent/hook/workflow/mcp → its **tech domain**; a **`context`** artifact (CLAUDE.md/
  conventions) → **Context Creation**; unplaced → the team's **General**. A **task** about *building*
  tooling → Context Creation; product tasks → their tech domain. Artifact **types expanded to 7**:
  agent, skill, hook, context, **workflow, mcp, other**. Built + kept; live-verified in QA.

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

## D. LLM extraction-quality — status after live QA (07-01). Prompt-only, NO rule-based hacks.

**Works** (live-tested, 3 teams): D1 no-drop (rejected idea → `wont_fix` task) · D3 `change_kind`
always set · D5 owners incl. different-person · D6 strong names + summaries · D7 risks→issues ·
cross-week id-matching & sticky due-dates · artifact→tech-domain + `context`→Context Creation (A4).
D2 folded into A1+A2. D4 (note-discipline) + D8 (draft-time owner default) kept.

**Still FAILING — OPEN (fix with clean prompting, NOT rules):**
- **Over-inclusion:** the model re-lists prior-week tasks/artifacts the current notes DON'T mention
  (spurious history row). Worst on the "Multi-week tasks:" pattern; ~1/3 clean prompt-only.
- **Statement-form misrouting:** a completion stated flatly ("the X is done") or an AI-Lead decision
  ("we decided not to …") lands in `discussion` instead of updating the task / becoming an action item.

> A rule-based guard + special-case prompt rules were tried for these two and **REVERTED** (wrong
> tool for an LLM product) — fix with general NLP prompting + the UI-review step, not rules.

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
