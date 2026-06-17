# AI Adoption Tracker — First Draft

**Status:** Draft. Omer flagged that this may have missed his core intent from the
recent discussion; to be revised after we talk. Written in plain language on purpose.

---

## What it is

A small personal web tool for the AI-enablement lead to keep track of how each team is
adopting Claude Code. He meets each team's champion roughly every week; after each
meeting he records what happened. The tool remembers everything and, for each team's
area of work, shows both the current picture and the full history.

It runs offline (air-gapped), it's for one user, and it may be thrown away after a few
weeks if it doesn't prove useful — so it's kept deliberately small.

---

## What it tracks

- **Teams** — each team has one or more **Domains** (areas of work).
- **Domain** — a (team, area-of-work) pair. This is the main thing everything attaches
  to. A domain has:
  - a **Champion** (the point person; can change over time),
  - its **priority** compared to other domains,
  - **scope notes** (what the work covers),
  - **how it relates to other domains**,
  - a one-time **starting snapshot** of the team's Claude Code setup, taken at the first
    meeting and never changed afterwards.
- **Task** — a real piece of work the champion runs end-to-end with Claude for the team
  (e.g. curate the team's context files, build a skill). Has: short name, description,
  owner, status, start date, end date. Status is one of: planned, in progress, finished
  successfully, finished with issues, blocked, abandoned.
- **Artifact** — something built or used: an agent, a skill, a hook, or a context file.
  Has: name, type, and tags. Tags come from a fixed list (used by champion only, used by
  team, under test, proven, updated regularly, not updated, made by the enablement lead,
  problematic) plus any free-text tags you want to add.
- **Action item** — a smaller, optional to-do that came out of a meeting. Can be owned by
  the champion or by the enablement lead. May get dropped without being done. Kept
  separate from tasks (tasks are committed work; action items are "maybe" work).
- **Meeting report** — what you record after each weekly meeting (see below).

> Note: there are no "goals" — dropped, too vague for champions to give.

---

## The weekly meeting report

Each week, for a domain, you record one report. It holds:

- meeting date and participants (default: the champion + you),
- free text: what was discussed,
- **changes to tasks** — a task added, a status change, or a task dropped — each with a date,
- **changes to artifacts** — added, updated, retired, or moved (e.g. from champion-only to
  the whole team) — each with a date,
- **action items** with their owner,
- issues or new things the champion raised,
- free-text notes.

The first meeting also sets up the domain-level info (priority, scope, cross-domain
relevance) and the starting Claude Code snapshot. So a first meeting = fill in the domain
details + record a normal report. There's no separate "first meeting" form.

**The time-saver:** eventually you won't type the structured report by hand. You'll paste
your raw notes and Claude will turn them into the structured report for you.

---

## How the tool remembers things

It keeps two things side by side, and updates both whenever you save a report:

1. **The current picture** — for each task and artifact, what it is *right now* (its
   latest name, status, tags). This is what the Domain page shows at a glance.
2. **The history (the "story")** — a dated list of every change ever made (task X added on
   this date, skill Y retired on that date, and so on). This is what lets the tool say
   "we finished task X — three weeks after it started; retired one weak skill; created two
   new ones."

Saving a report updates both at once. The tool never has to rebuild the present by
re-reading the whole history — the current picture is always just there.

For tasks, the history only needs the start, the end, and the current status (you said you
don't care about every status change in between). For artifacts, the history keeps the full
story (added / edited / retired / moved). That difference is only about what we *show* — it's
the same underlying history list.

---

## Telling items apart from week to week

Each task and artifact gets a short, fixed nickname (e.g. `onboard-pilot`) that stays the
same every week. When a later report mentions it, the tool knows it's the same item by that
nickname. A new nickname means a new item. When Claude generates a report from your notes,
it's shown the existing nicknames so it reuses them — and you can check the matches before
saving.

---

## One definition, used three ways

There is a single definition of "what a report can contain." That same definition is used
for three things at once:

1. the structure of the form you fill in,
2. what Claude must produce from your raw notes,
3. what the tool checks before saving a report.

When you want to track something new later, you extend this one definition — and everything
follows.

---

## Growing it later

If, after a few weeks, you notice the same kind of information keeps ending up in the
free-text notes, you can turn it into a proper field of its own. Because every report's
original raw notes are saved, you can go back and fill that new field into the old reports
too — by re-reading the saved notes (by hand, or with Claude).

This is the "breathing" part: it starts small, grows where real use demands it, and the
unused parts simply never get added.

---

## The screens

1. **Manage** teams / domains / champions.
2. **Add a weekly report** for a domain.
3. **Artifacts registry** — the list plus its history.
4. **Tasks list.**
5. **Domain page** — the hub; shows everything for one domain: current picture + the story.

A **manager dashboard is not part of this first version** — we don't yet know what's worth
showing, and we'll only know after using the tool for a few weeks.

---

## What we are deliberately NOT building yet

- Manager dashboard
- Fancy search / queries
- Goals (dropped)
- Logins / multiple users (it's just you, offline)
- Anything auto-generated beyond the report itself
- Task priorities (maybe a later addition)

---

## Open items to settle next

- Omer's sense that this draft may have missed his core intent — discuss and revise.
- The mock screens built earlier need a pass: which survive, which get cut, which shrink.
