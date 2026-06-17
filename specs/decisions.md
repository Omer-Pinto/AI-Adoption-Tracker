# Decisions log — AI Adoption Tracker

> Plain-language record of choices made while building, so nothing is silent.
> **Rule:** this file only *records closed calls.* Anything that needs doing is a real
> task in a wave — never a TODO that lives only here. **Wave 5 is a gate that checks this
> file has zero open items before the project is called done.**
> Updated 2026-06-18.

---

## Decided by Omer — now real tasks in a wave

- **AI drafting endpoint** — OpenAI **and** Anthropic both supported; you pick in config;
  URL + key in `.env` (never committed). → Wave 2, Agent 2A.
- **First meeting = first report** — no special seed step; the first meeting is just the
  team's first report. → Wave 2, Agent 2B.
- **Finish date = the date you give** — the app never guesses it. → Wave 2, Agent 2B.
- **Editing a report updates everything it touched** — including domain description/scope/
  priority, even if you fix it minutes later. Not an "edge case." → Wave 2, Agent 2B.
- **Bad reference gives a clean message, not a crash.** → Wave 2, Agent 2C.
- **Search handles `%` / `_` in names literally.** → Wave 2, Agent 2C.
- **`@` / `#` mentions while writing a report** — fuzzy-find any task / any tool, pick one or
  type a new name; new ones are created from the note. → Wave 3, Agent 3C.
- **Names come from notes** — you never pre-register a task or tool. (Confirmed intended.)

## Accepted as-is (closed — recommend leaving; plain reason)

- **Who owns a task** — taken from the most recent report that named an owner.
- **A tool's one-line summary** — filled from the note describing its change.
- **Retired tools stay listed** (marked retired), not deleted — keeps history honest.
- **"Model unreachable" message** — if the AI endpoint is set but down, the app says so
  clearly (separate from "not configured").
- **Search `date:`** — means "the task was active on that day."
- **Search `date:` on tools** — does nothing (tools have no dates of their own).
- **Search `tag:`** — accepts any tag text (tags are open-ended), not a fixed dropdown.

## Open items

None. (If any arise in later waves, they get added here AND as a task; Wave 5 confirms this list is empty.)
