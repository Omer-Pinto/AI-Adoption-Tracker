# Web Experience — setup

**Team display name:** `Web Experience` (folder = team name)
**Champion(s):** `Noa` (single champion)

## What Omer creates MANUALLY (Manage page)
- The **team** `Web Experience`.
- The **champion** `Noa` under that team.
- (Optional) `team.cc_baseline` / "Current Claude Code status" — free text, not exercised here.

## What is created via the LLM "Smart domain extract" flow
Paste the single block below into **Smart domain extract** for champion **Noa**, then accept
the proposals. Do NOT type these by hand — the point is to exercise the extractor + the
`Priority Order:` arrow-mapping logic. All four domains land under Noa in one paste.

```
1. Web Frontend - react, typescript, nextjs, tailwind, storybook
2. Design System - component library, figma, design tokens, accessibility
3. Mobile - react native, expo, ios, android
4. API Gateway - graphql, apollo, bff, node
Priority Order: 1 -> 2 -> 3 -> 4
```
Expected: Web Frontend = priority 1, Design System = priority 2, Mobile = priority 3,
API Gateway = priority 4.

## Auto-created domains (do NOT add these)
Two constant domains are minted automatically the first time you draft a report for Noa —
do not create or list them. Noa gets exactly ONE of each:
- **General** — the unplaced/fallback bucket (priority null).
- **Context creation** — a REAL placement target (priority "1") for CLAUDE.md / context
  files / conventions.

## Same-champion cross-week artifact continuity (this is the team that tests it)
- **Artifacts are TEAM-wide.** An artifact created in one report IS visible in Noa's later
  draft context. The dataset uses this on purpose: Noa creates a **team-wide `a11y lint`
  skill** (no domain) in Report 1; she **references the same skill** again in Report 4 and it
  must MATCH the existing team artifact (update, not duplicate) and stay team-wide (no domain).
  See those two reports.

## Feed order
Global chronological order (so the a11y skill exists before it's matched in a later week):
`Noa 20260506` → `Noa 20260507` → `Noa 20260513` → `Noa 20260514`.
Save each report before drafting the next (the LLM only sees PRIOR-saved tasks/artifacts).
