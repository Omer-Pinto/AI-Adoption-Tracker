# Web Experience — setup (MULTI-CHAMPION team)

**Team display name:** `Web Experience` (folder = team name)
**Champions:** `Daniel` AND `Rivka` (this team exercises the **2-champion** case)

## What Omer creates MANUALLY (Manage page)
- The **team** `Web Experience`.
- **Two champions** under it: `Daniel` and `Rivka`.

## What is created via the LLM "Smart domain extract" flow
Domains are **per-champion**. Insert a SEPARATE block under each champion (Daniel and
Rivka own different areas). Paste, then accept.

**For champion `Daniel`:**
```
1. Web Frontend - react, typescript, nextjs, tailwind, storybook
2. Design System - component library, figma, design tokens, accessibility
Priority Order: 1 -> 2
```
Expected: Web Frontend = priority 1, Design System = priority 2.

**For champion `Rivka`:**
```
1. Mobile - react native, expo, ios, android
2. API Gateway - graphql, apollo, bff, node
Priority Order: 1 -> 2
```
Expected: Mobile = priority 1, API Gateway = priority 2.

## Auto-created domains (do NOT add)
**General** and **Context creation** are minted **PER CHAMPION**. So this team ends up with
TWO Generals and TWO Context-creations (Daniel's and Rivka's) — that is correct, not a bug.

## IMPORTANT scoping subtlety (this is the team that tests it)
- **Domains and tasks are per-champion.** Daniel's tasks are NOT visible in Rivka's draft
  context, and vice-versa — so do NOT expect cross-champion TASK matching.
- **Artifacts are TEAM-wide.** An artifact created in Daniel's report IS visible in Rivka's
  draft context. The dataset uses this on purpose: Daniel creates a **team-wide `a11y lint`
  skill** (no domain) in his week 1; Rivka **references the same skill** in her week 2 and it
  must MATCH the existing team artifact (update, not duplicate). See those two reports.

## Feed order
Global chronological order (so Daniel's a11y skill exists before Rivka references it):
`Daniel 20260506` → `Rivka 20260507` → `Daniel 20260513` → `Rivka 20260514`.
Save each champion's report before drafting that champion's next one.
