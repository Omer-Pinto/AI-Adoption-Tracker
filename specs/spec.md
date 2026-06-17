# AI Adoption Tracker — Spec

**Status:** Agreed design. Basis for task breakdown. Supersedes `first_draft.md`.
Plain language on purpose; real schema where it matters.

---

## 1. What it is

A small, personal, offline (air-gapped) web tool for the AI-enablement lead to track how
each team adopts Claude Code. He meets each team's **champion** roughly weekly; after each
meeting he records what happened. The tool keeps the full week-by-week journey of every
team's domains, tasks, and artifacts.

The product is the **journey** — how things moved week to week — not a current-state
dashboard. (A manager dashboard is explicitly out of this version.)

---

## 2. Scope & non-goals

**In:** team/champion/domain management · per-champion weekly reports drafted by the model from
raw notes (editing the structured report is the only manual surface) · tasks (week-by-week
journey) · artifacts registry (change history) · action items · team & domain pages.

**Out (for now):** manager dashboard · advanced search/queries · goals · auth/multi-user ·
task priority (maybe v2).

---

## 3. Core concepts

- **Team** — a group; has a one-time "starting point" snapshot of its Claude Code maturity
  (people began using CC raw, not per-domain — so this lives on the team, not the domain).
- **Champion** — the point person for a team's adoption. Belongs to a team. Can start and
  (later) leave. A team usually has one champion across several domains.
- **Domain** — an area of work for a team (e.g. firmware, signal-processing). The thing
  tasks and artifacts attach to. Has a champion, a priority vs other domains, scope, a free
  description, and cross-domain relevance.
- **Report** — one record per **champion meeting** (not per domain). One meeting covers all
  of that champion's domains at once.
- **Task** — a real piece of work a champion runs with Claude for the team. Tracked
  **week by week**: every meeting, every open task gets a line — even "still in progress,
  did X, Y, Z."
- **Artifact** — something built/used: agent, skill, hook, or **context** (a named context
  *setup* — its summary says whether it's one CLAUDE.md, several files, a router pattern, etc.).
  Each artifact has a short **summary**. It belongs to a **team**, and **optionally** to a
  domain — un-domained artifacts are general/team-wide. Tracked **only when it changes** (added /
  updated / retired / moved). Skills rarely change weekly.
- **Action item** — a smaller, optional to-do from a meeting; owner can be the champion or
  the lead; may be dropped. Separate from tasks (tasks are committed; action items are "maybe").

The **story** (history) is a list of **changes**, each narrating *the change itself*
("retired skill X — too noisy; created 2 new"), not a state snapshot.

---

## 4. The weekly report (per champion)

One report = one meeting with one champion, covering all their domains. The raw notes live
**inside** the report document. Structure:

```json
{
  "champion": "Dana",
  "meeting_date": "2026-06-15",
  "participants": ["Dana", "Omer"],
  "raw_notes": "<the notes pasted verbatim>",
  "domains": [
    {
      "domain": "signal-processing",
      "changes": { "priority": 2 },          // only domain fields that changed; omit if none
      "tasks": [
        { "task": "CFAR tuning",  "status": "abandoned",   "note": "retired — not worth continuing" },
        { "task": "Clutter map",  "status": "in-progress", "note": "still going; ran first pilot this week" },
        { "new_task": "Doppler check", "status": "planned", "owner": "Dana", "note": "started instead" }
      ],
      "artifacts": [
        { "new_artifact": "clutter-review", "type": "skill", "tags": ["under_test"], "note": "created to speed review" }
      ]
    }
  ],
  "action_items": [ { "text": "find a context-usage tool", "owner": "Omer" } ],
  "discussion": "demoed a meta-skill",
  "issues": "champion flagged repo-access problem"
}
```

The same JSON structure does three jobs: the **form** layout, the **validation** on save,
and the **contract** for the model that drafts the report from raw notes.

### Creating, previewing, editing a report

- **Create (notes → model) — the ONLY creation path:** from a Team page, click *Create report*
  and paste your raw meeting notes. The model (your air-gapped endpoint) drafts the structured
  report — rephrasing, de-duplicating, and mapping your notes onto the report fields and the
  existing tasks/artifacts. You never hand-structure a report from scratch.
- **Preview → confirm:** you see the drafted report, *not yet saved*. Fix anything, then confirm
  to write it to the database (fan-out to the tables).
- **Edit a saved report:** a form bound to that report's structured JSON — you edit the
  structured fields directly (not the original notes). This is the only manual-typing surface;
  there is no from-scratch manual entry.
- **Endpoint:** the model endpoint is yours to provide and is **required to create reports** (the
  drafting call goes through a thin adapter). **Both OpenAI and Anthropic APIs are supported; a
  config value selects the provider.** The endpoint **URL** and **API key** are read from `.env`
  (air-gap-supplied; `.env` is git-ignored, never committed). Editing existing reports works without it.
- **First meeting:** there is no special seeding path — the first meeting is simply the team's
  **first report**: "Current Claude Code status" (existing skills/agents/CLAUDE.md/workflows) is
  entered as **artifacts** `added` in that first report, and the team's raw starting point goes in
  `team.cc_baseline`. A task's `started_on` is the date of the earliest report that mentions it.

### Updating a saved report

The full `report_json` is always kept, so a report can be reopened in the same form, edited,
and re-saved. On re-save: delete the history rows this report created (they carry its
`report_id`), re-apply the edited report, then recompute the current state of every task,
artifact, **and domain field** it touched by replaying that champion's reports in date order
(an edit made minutes later must be reflected too — domain description/scope/priority included). At this scale (one champion, a
few dozen reports) the replay is instant. Most edits are to the report you just created — the
latest one — where this is trivial; editing old reports is rare and the replay keeps it correct.

---

## 5. How data is stored

Two kinds of tables: **"what it is now"** tables, and **history** tables. Both are written
when a report is saved. The current-state row is never rebuilt by replaying history — it's
kept directly, so reads are trivial.

**team** — `id · name · cc_baseline · baseline_date`
**champion** — `id · name · team_id · start_date · end_date(nullable)`
**domain** — `id · team_id · champion_id · name · description · scope · priority · cross_domain`
**report** — `id · champion_id · meeting_date · report_json · schema_version`

**task** (current state) — `id · domain_id · name · status · owner · started_on · ended_on`
- status enum: `planned · in-progress · finished_successfully · finished_with_issues · blocked · abandoned`

**task_history** (the weekly journey — one row per task per meeting it's discussed)
- `id · task_id · report_id · meeting_date · status_at_meeting · change_note`

**artifact** (current state) — `id · team_id · domain_id(nullable) · name · type · tags · summary`
- type: `agent · skill · hook · context` — a `context` artifact is a named context *setup*; its
  `summary` describes its shape (single CLAUDE.md / multiple files / router pattern / etc.).
- `domain_id` **nullable**: null = general/team-wide artifact, shown in the team page's **All-team
  gutter**. A report can add an artifact with no domain (team-level).
- `summary`: short human description; shown in the artifact's **detail modal**.
- tags: fixed set (`in_use_by_champ_only · in_use_by_team · under_test · proved_worthy ·
  updated_periodically · not_updated · created_by_enablement_lead · problematic`) plus any
  free-text tags.

**artifact_history** (one row only when it changes)
- `id · artifact_id · report_id · meeting_date · change_kind(added/updated/retired/moved) · change_note`

**action_item** — `id · report_id · domain_id(nullable) · text · owner · due_date · resolved`

Notes:
- `report` has **no** domain_id (it's per champion). History tables have **no** domain_id —
  the domain is reached via the task/artifact (`task → domain`).
- The full `report_json` (with raw_notes) is kept as the audit + backfill safety net, in
  addition to the fanned-out rows.
- **Task dates:** `started_on` is derived (the earliest report that mentions the task).
  `ended_on` is **user-supplied, never auto-computed** — it defaults to the report's
  `meeting_date` and can be overridden per task on the report line.

---

## 6. Worked example (end-to-end trace — the self-test)

Champion **Dana** (team Radar), domain **signal-processing**. Meetings 06-08 and 06-15.

**Saving the 06-15 report** (the JSON in §4) does, in one transaction:

`report` → `{id:42, champion_id:Dana, meeting_date:06-15, report_json:{…}}`

`task` (current state, after save)
| id | domain | name | status | owner | started_on | ended_on |
|----|--------|------|--------|-------|-----------|----------|
| 1 | signal-proc | CFAR tuning | abandoned | Dana | 06-01 | 06-15 |
| 2 | signal-proc | Clutter map | in-progress | Dana | 06-01 | — |
| 3 | signal-proc | Doppler check | planned | Dana | 06-15 | — |

`task_history` (the journey)
| task | report | date | status_at_meeting | change_note |
|------|--------|------|-------------------|-------------|
| Clutter map | 41 | 06-08 | in-progress | "first draft of map" |
| CFAR tuning | 42 | 06-15 | abandoned | "retired — not worth continuing" |
| Clutter map | 42 | 06-15 | in-progress | "still going; ran first pilot" |
| Doppler check | 42 | 06-15 | planned | "started instead" |

`artifact_history` (only the change)
| artifact | report | date | change_kind | change_note |
|----------|--------|------|-------------|-------------|
| clutter-review | 42 | 06-15 | added | "created to speed review" |

**Read-back, end of 06-15:**
- *What's active now?* → `task` where status not in (finished*, abandoned) → **Clutter map, Doppler check**. (CFAR tuning still on record, marked abandoned.)
- *Story of this domain?* → `task_history` + `artifact_history` ordered by date → the full
  arc: Clutter map progressing, CFAR retired, Doppler started, clutter-review skill added.

Nothing is lost; the journey is intact.

---

## 7. Screens (UI)

One MVP — everything needed to both log and see the work:

- **Management** — create/edit teams, champions, domains. Each section is a **list with Add/Edit**;
  clicking Edit opens **one clean isolated form** (modal) — never all the forms on screen at once.
- **Create / edit report** — *create:* paste raw meeting notes → the model drafts the structured
  report (rephrase, dedup, map to fields) → preview → fix → confirm → save. *Edit:* a form bound
  to the saved structured JSON (edit the fields, not the original notes). No from-scratch manual
  creation (see §4). **Mentions:** in the report editor, typing `@` fuzzy-finds **any** existing
  task and `#` **any** existing artifact (Jira-style — all of them, not domain-scoped); you either
  pick an existing one or type a new name (new tasks/artifacts are created from the note, not
  pre-registered).
- **Team page** — the hub. One champion's set of domains for a team: each domain's current
  tasks & artifacts **+** the full week-by-week story, plus that champion's reports and action
  items. It's really *a champion's portfolio of domains*, but **named after the team** (the
  champion can change). A team split across two champions → **two pages**; when a champion is
  replaced, the new one inherits the same page and domains, history intact. Keyed internally by
  champion, labeled by team. Artifacts are grouped under their domain, plus an **All-team gutter**
  for general (un-domained) artifacts. Clicking any artifact opens its **detail modal** (summary +
  full data + history). No search bar here — you browse.
- **Domain page** — drill into a single domain: its current tasks/artifacts + full story. Clicking
  an artifact opens its **detail modal** (not a navigation away).
- **Artifacts registry** — all artifacts, filtered with the **gradual search bar** (see below) on
  keys team/domain/type/tag/status/date — not a company-wide dump. Rows open the **detail modal**
  (summary + full data + change history).
- **Tasks** — all tasks, filtered with the **same search bar**; each row expands to its
  week-by-week journey.

### Search bar (Artifacts & Tasks)

A gradual `key:value` chip search bar (e.g. `team:radar domain:signal-processing status:blocked`),
lifted from the **SoccerSmartBet** project — a framework-agnostic Python parser/compiler already
running on FastAPI, plus a zero-dependency vanilla-JS chip UI. Keys for this app: `team`, `domain`,
`type`, `tag`, `status`, `date`. Each key has an autocomplete endpoint; the filter round-trips to the
URL (shareable filtered views); adding a key later is ~3 small edits. It replaces the team dropdown
and the per-type/tag pills entirely. Caveat: SoccerSmartBet compiles to Postgres — adapt the SQL to
SQLite. Used on **Artifacts** and **Tasks**; the teams index / team pages don't need it (browse).

**Deferred — one thing only:**
- **Manager dashboard** — we still don't know what's worth showing; building it now would
  re-create the invented metrics we deliberately threw out. Add after a few weeks of real use.

---

## 8. Reading data back

- **Current state** (domain page, lists): plain SELECTs from the `task` / `artifact` tables.
- **The story** (timeline): SELECTs from `task_history` / `artifact_history`, ordered by date.
- **Durations** ("3 weeks since inception") computed at render from the dates.
- **Manager-facing narrative report**: later, generated by an LLM over the stored rows — not
  MVP. MVP reads are simple queries only; no advanced query layer.

---

## 9. Growing it later

When a kind of info keeps landing in free-text notes, promote it to a real field: add the
column, bump `schema_version`, and backfill old reports by re-reading their stored
`report_json` / raw_notes (by hand or with Claude). Starts small; grows where real use
demands it.

---

## 10. Open / deferred

- Manager dashboard — after a few weeks of real data.
- Task priority — maybe v2.
- Air-gapped model endpoint — **decided (no longer open):** OpenAI **and** Anthropic supported,
  with provider + URL + key chosen via `.env` config; required to create reports, editing works
  without it. Implemented in Wave 2 (Agent 2A).
- UI / layout of the MVP pages — still to be designed (next step).
