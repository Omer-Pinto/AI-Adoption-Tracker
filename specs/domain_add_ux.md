# Domain-Add UX — design spec (Wave 6 / 6A) — DECIDED

> Status: **approved by Omer 2026-06-24.** Final decisions + the page-vs-modal verdict are baked in below. Grounded in live code: `pages/manage/ManagePage.tsx`, `DomainForm.tsx`, `pages/domain/DomainSetupPage.tsx`, `components/Modal.tsx`, `router.tsx`, `api.ts`. No backend/API changes — every flow uses existing `api.domains.{extract,create,update,list}`.

## 1. Decision
**Two clearly-labelled buttons** on the Domains tab, each going to the surface that fits it:
- **"+ Add Domain"** (primary) → **modal** — add ONE domain manually (the existing `DomainForm`).
- **"Smart domain extract"** → **page** — paste text → AI proposes many domains → review/fix → approve each.

This replaces today's confusing pair (grey "Set up domains" link + purple "+ Add Domain") with two buttons whose labels say exactly what each does. The old grey **"Set up domains" link is removed.**

## 2. Why the extract flow is a PAGE, not a modal (verdict)
A modal is right for a light, single-transaction task (add a champion, add one domain). The extract flow is not that — it's a multi-phase **approval queue**: each proposal card already runs its **own** `api.domains.create` with its own saving/error/saved state (N independent commits in one surface). Two decisive reasons it must be a page:
1. **N-record approval queue, not a form.** 6–10 tall editable cards (each with an inner-scrolling cross-link list) = thousands of px of triple-nested scroll inside a modal; on a page it's one honest scrollbar with real headings.
2. **Click-outside data loss.** The shared `Modal` closes on Escape + overlay-click. Omer's rule is "no warning on close" (6A) — safe for a page (leaving is deliberate), reckless for a modal (a stray margin-click silently destroys unsaved edited proposals). A page makes 6A correct for free.

(Manual single-add stays a modal — a bounded single transaction, the textbook modal case.)

## 3. Button A — "+ Add Domain" (manual, modal)
The existing `DomainForm` modal, with two changes:
- **Block Save** until **Name** is non-empty (inline "Name is required") — today it saves empty and relies on the backend.
- **Priority** is a **numeric input (1, 2, 3, …)**, not free-text — hint "Lower number = higher priority".
- Fields otherwise unchanged: Team, Champion (filtered to team), Name (req), Description, Priority (number), Cross-domain links. Save → `api.domains.create`; success → close + reload table.

## 4. Button B — "Smart domain extract" (page)
The existing `DomainSetupPage` flow, **kept as a page**, reached from this button (old grey link gone — no redirect; it's a dev tool nobody used). Route may be renamed to `/domains/extract` at the implementer's discretion.
- **Flow:** pick Team → Champion (auto when the team has only one) → paste text → **Extract** (`api.domains.extract`) → editable proposal cards → per-card **Approve & save** (`api.domains.create`).
- **One champion per batch** — chosen up front; every proposal saved under it.
- **States:** empty / extracting / proposals / per-card edit / name-required / save-error / **no-results** ("No domains found in that text. Edit it and extract again, or add one manually.") / partial-approve.
- **Re-Extract with unsaved edits → WARN first** (5B): confirm "Re-extracting discards your unsaved edited proposals. Continue?" (needs a per-card dirty flag; `handleExtract` currently resets blindly).
- **Close = just leave, no warning** (6A) — safe because it's a page.
- Proposals carry the same **numeric Priority**.

## 5. Domains list
Show saved domains **sorted by numeric priority, nulls last**. Backend `priority` stays TEXT-backed for now (stores the numerals); sort numerically client-side. A real schema change to INTEGER is out of scope unless Omer asks.

## 6. Wave 7 handoff (frontend-developer)
- `pages/manage/ManagePage.tsx` — two buttons ("+ Add Domain" → manual modal; "Smart domain extract" → extract page); drop the grey "Set up domains" link; sort the domains table by numeric priority (nulls last).
- `pages/manage/DomainForm.tsx` — empty-Name Save guard (~line 224); Priority → numeric input (~lines 71–76).
- `pages/domain/DomainSetupPage.tsx` — keep as the extract page; add the 5B re-Extract warning + per-card dirty tracking (~lines 197–211); add the no-results empty state.
- `router.tsx` — wire the extract page to the new button; remove the old grey-link usage; no `/domains/setup` redirect (optional route rename).
- No `api.ts` / backend / types changes.
