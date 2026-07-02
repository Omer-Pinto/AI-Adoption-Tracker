# UI Redesign Brief — "Aurora" design language

**Goal:** transform the AI Adoption Tracker from a generic dark dashboard into a
premium, modern, *memorable* product UI — a genuinely different story with a "wow"
factor, without changing backend behavior or removing any functional element
(the chip **SearchBar** especially must stay fully functional).

Branch: `amazing-ui-overhaul` only. Live target: http://localhost:5173.

> **Status (July 2026): DELIVERED this `/goal` session** — changes are live on the branch and
> left **uncommitted** in the working tree (per Omer's preference). Sections 1–8 below are the
> design spec and were all implemented. Section 6's account/shell plan was later **superseded** by
> Omer's feedback (see the ⚠️ note there and §10). The end of this file (§10–§12) is the running
> **report of what shipped + follow-ups**. Fonts self-hosted via Fontsource; `tsc` + `vite build`
> green; WCAG-AA contrast/focus pass applied; both light + dark verified.

---

## 0. Non-negotiables (do not break)
- **No backend changes.** Frontend only (`src/frontend/`).
- **Keep every functional element:** SearchBar (chip DSL, URL `?q=` sync, keyboard nav),
  expandable task/ai-lead rows, report editor `@`/`#` mentions + per-domain color selects,
  RBAC-conditional affordances, theme toggle, all edit/create/delete flows.
- **Both themes must stay correct** (light + dark). Every new color needs its dark override.
  Fix, don't inherit, the existing low-contrast bugs (e.g. near-invisible task names on Tasks).
- **Accessibility:** WCAG AA contrast for text; visible focus rings; `prefers-reduced-motion`
  disables non-essential motion; keyboard paths preserved.
- Preserve routes, props, data flow. This is a **visual/interaction** redesign.

## 1. Signature & mood
Own a **signature aurora** identity: a refined indigo→violet→cyan gradient used *sparingly* as
the brand's fingerprint (logo mark, active nav state, primary CTA, key focus accents, a soft
ambient background glow). Everything else stays calm and neutral so data — not chrome — carries
the color. Mood: confident, editorial, spacious, quietly premium (think Linear / Vercel / Raycast
polish), not flashy-for-its-own-sake.

## 2. Typography (add real web fonts — currently system-only)
Load via Fontsource (npm, self-hosted — no external CDN dependency at runtime) or a single
Google Fonts `<link>`. Pairing:
- **Display / headings:** `"Space Grotesk"` — characterful geometric grotesk. Use for page-header
  titles, hero numbers, metric values, section titles. Tight tracking, weight 500–700.
- **Body / UI:** `"Inter"` (with `font-feature-settings: "cv05","ss01"` optional) for all body,
  labels, table text, forms.
- **Mono / numerals:** use `"tabular-nums"` (`font-variant-numeric: tabular-nums`) on all
  numeric/date/metric cells for ledger-style alignment. Keep `"JetBrains Mono"` or SF Mono for
  any true monospace bits.
- Establish a real **type ramp** (don't scatter literal px): e.g. `--text-xs 11 / sm 12.5 / base 14 /
  md 15 / lg 18 / xl 22 / 2xl 28 / 3xl 36`, with matching line-heights and letter-spacing tokens.
  Eyebrows: 11px uppercase, 700, letter-spacing .08em, muted.

## 3. Color system (tokenize; keep light + dark)
Refine the existing token set in `design-system.css` `:root` / `html[data-theme="dark"]`.
- Keep semantic token names (`--bg`, `--surface`, `--surface-2/3`, `--border*`, `--text*`,
  `--accent*`) so downstream classes keep working. Improve the *values*.
- Neutrals: slightly warmer, more layered. Dark base should feel deep and rich (near-black with a
  faint blue undertone), not flat gray. Add elevation via subtle top-highlight borders.
- Add gradient tokens: `--grad-aurora` (indigo→violet→cyan), plus `--glow-*` radial ambient tints.
- Status palette: redesign badges/chips for AA contrast in both themes (finished=emerald,
  in-progress=blue, planned=slate, blocked/abandoned=rose, won't-fix=zinc, finished-w-issues=amber).
  Soft translucent fill + saturated text + optional leading dot. Keep `StatusBadge` / `ArtifactTypeBadge`
  / `ChangeKindBadge` class contracts; restyle centrally.
- **Sweep inline hard-coded hex** where feasible (EmptyState, ForbiddenPage, NotFoundPage, DomainStory
  dots, page `style={}` colors) onto tokens so dark mode is correct everywhere.

## 4. Spacing, radius, elevation
- Spacing scale tokens (4px base): `--sp-1..--sp-8`. Generous page padding, breathing room.
- Radius scale: inputs/buttons ~8–10px, cards/panels 14–16px, pills full. Softer, larger than today.
- Elevation: layered, low-spread, soft shadows + hairline borders; on dark, use border-highlight
  (1px inset top light) instead of heavy shadow. Optional frosted glass (`backdrop-filter: blur`)
  on the sticky top bar and sidebar footer.

## 5. Motion system (new — currently near-zero)
Add a small, purposeful motion layer (all behind `prefers-reduced-motion: reduce` → none):
- Content entrance: subtle fade + 6–10px rise on route/section mount; stagger list rows.
- Hover: cards/rows lift + border-accent; buttons subtle scale/gloss; nav item accent slide.
- Numbers: metric tiles count-up on mount (cheap, JS or CSS).
- Expand/collapse (folds, task rows): smooth height/opacity, not instant.
- **Loading:** replace bare "Loading…" text with shimmer **skeletons** matching each surface.
- Keep it fast (150–300ms), eased (`cubic-bezier(.2,.7,.2,1)`), never blocking interaction.

## 6. App shell redesign (the parts the user explicitly disliked)
- **Logo:** new mark + wordmark. Aurora-gradient mark (crisp, not the flat rounded-square),
  refined wordmark. Rework the version pill into something subtle. Header text on pages
  ("Teams / All team champion portfolios" etc.) → editorial page-header pattern:
  small eyebrow + large Space-Grotesk title + muted supporting line, actions right-aligned as a
  clean segmented group. Modernize wording where it reads stiff.
- **Sidebar:** keep left rail (good for this app) but make it premium — better spacing, refined
  section labels, gradient active-pill with left accent bar, crisp icons, hover states. Consider a
  subtle glass/gradient edge. Sidebar stays dark in both themes (intentional) but should look
  designed, not flat #1a1d23.
- **Account / settings (user disliked "user settings on the left"):** ⚠️ **SUPERSEDED — see §10.**
  Initial plan was a polished bottom-left profile chip. Omer's feedback: bottom-left + a standalone
  "Dark mode" button isn't modern. **Final:** the account moved to a **top-right avatar menu**
  (gradient-ring avatar → dropdown: name/role, Change password, Log out); the **theme toggle is a
  separate icon-only sun/moon button** beside the avatar (tooltip, no words); the sidebar footer was
  removed; and the **sidebar logo now links to the user's home** (`landingPath`).
- **Top-row buttons:** restyle all buttons (primary = aurora gradient or solid accent with subtle
  depth; secondary = quiet tinted; outline; danger). Consistent sizing, radius, focus.

## 7. Tables (user explicitly disliked them)
`DataTable` is a thin markup component — restyle centrally via `.data-table` + polish block.
- Comfortable row height, hairline separators (no heavy grid), **strong readable text** (fix the
  faint task-name contrast), tabular numerals on dates/counts, right-aligned numerics.
- Sticky **glass** header, uppercase micro-labels, sortable affordance styling ok.
- Row hover: soft surface tint + a 2px aurora left-accent that slides in.
- Rich cells: name as primary link (accent on hover), status via new badges, avatars for owners/champions.
- Empty & loading states designed (skeleton rows + friendly empty).
- Tasks page + AI-Lead page hand-roll their own `<table>` — bring them to the same look
  (respect their expandable-row / inline-edit behavior).

## 8. Cards & key surfaces
- Team cards: from empty rectangles → rich cards (gradient accent edge, champion avatar, domain
  count chip, mini-metrics, hover lift, clear primary/secondary actions).
- Metric tiles (TeamPage / AI-Lead): premium stat cards — big Space-Grotesk number (count-up),
  eyebrow label, delta/context line, subtle top gradient hairline, accent icon.
- Detail pages (task/artifact): editorial hero + facts + timeline, more air, better badges.

## 9. Working rules for implementers
- Follow this brief for a **cohesive** result; do not invent a second visual language per page.
- Reuse the tokens/primitives the foundation establishes; don't re-hardcode hex.
- Don't touch `src/backend/`. Don't remove functionality. Verify light AND dark.
- Keep diffs focused on styling/markup; preserve component prop signatures & data flow.
- After your change, the app must build (`tsc`/vite) and run clean (no new console errors).

## 10. Manual fixes after `/goal` (Omer's live feedback)

**Shell / account**
- Account moved to a **top-right avatar menu**; the sidebar footer was removed.
- **Theme toggle** = standalone icon-only sun/moon button beside the avatar (tooltip, no label) — deliberately *not* folded into the account menu.
- **Sidebar logo → home** (`landingPath`: `/` for admin/all-team, `/ai_adoption` for a champion).
- Fixed the top-right avatar **overlapping page action buttons** (reserved header space).
- Fixed the AI Lead header **avatar clipping** in the sticky top bar.

**Unified single-item page header (Team / Domain / Task / Artifact)**
- All four now share ONE pattern: a **slim top bar with only a back link** + a **body "hero"** block.
- Hero = an **icon-circle avatar** (identical gradient-ring treatment; glyph differs: Team=people, Domain=layers, Task=check-square, Artifact=box) + eyebrow (entity type) + display-font title + meta, with the page's **primary action inside the hero**.
- Removed the **duplicate title** each of these pages used to show twice (top bar + body).
- **"+ Create report"** moved from the Team top bar into the Team hero.
- Removed the now-redundant **Domain breadcrumb** (the top-bar back link replaces it).

**Redundant elements removed**
- Removed the dead **"Cancel"** button on New Report.
- Removed the redundant **"Manage teams / domains"** button on Teams (sidebar Manage covers it).
- Removed the **"All artifacts" / "All tasks"** buttons on the detail pages (kept "← Back").
- Removed the **"← Manage"** button on Domain Setup (breadcrumb covers it).

**Actions moved next to their content (AI-Lead pattern)**
- **"+ Add" primary actions moved from the page top bar to a toolbar directly above their table**: Manage ("+ Add Team", "+ Add domains"), Users ("+ Add User").
- **Create-flow convention:** quick create = **modal** (Add Team / Add User); multi-step LLM wizard = **dedicated page** (Add domains → the extraction flow).

**Other**
- **Task names on the Tasks page now link** to the task detail/edit page (`/tasks/:id`).
