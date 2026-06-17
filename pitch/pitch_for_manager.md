# Pitch Guide — AI Adoption Tracker

A walkthrough of the mock prototype: how it maps to the agreed UI model, what each
domain demonstrates, and a suggested demo sequence.

To view the prototype, open `index.html` in a browser (or serve this folder and open
`http://127.0.0.1:8765/index.html`).

---

## Part 1 — The 6 UI ideas ARE the 6 screen types (1:1)

Nothing was lost from the agreed UI model — each of the six UI parts is one screen type:

| UI idea | Screen type | Pages | What it's for |
|---|---|---|---|
| 1. Dashboard / Command Center | Dashboard | 1 | "Where do I look today?" — weekly triage |
| 2. Domain Case File | Case File | 7 (one per domain) | Deep view of one Team × Domain |
| 3. Weekly Logging Flow | Weekly Log | 7 | **The form filled each week per domain** |
| 4. Champion Meeting Prep | Prep | 3 | What to walk into a 1:1 with |
| 5. Operational Query / Ask Box | Ask Box | 2 | Ask anything across all the data |
| 6. Executive Projection | Exec Summary | 2 | The generated report for the manager |

---

## Part 2 — Each domain is a deliberate demo of one capability

The 7 teams aren't random — each was built to show the tool catching a *different*
kind of situation. The pitch: "watch it surface 7 different real situations."

1. **engineering / backend-services — "the success baseline."**
   Champion driving hard, target task *done*, artifacts being reused by peers. Shows
   the healthy / Accelerating state.
   → Click it under **All Domains** on the dashboard, or as a **Strong Example** in the
   Exec Summary.

2. **research / nlp-tooling — "the marquee recovery."**
   Was blocked 4 weeks by 3 model failures → champion Amara remediated → candidate eval
   *passed* → just unblocked. The **failure-ledger → remediation → eval pipeline** end to end.
   → Open its **Case File** (Failures + Evals panels), or ask the **Ask Box**:
   *"Which domains are blocked by model failures?"*

3. **infrastructure / platform-reliability — "the journey survives a person."**
   Champion **rotated** (Noah left → Ravi took over) and the domain kept moving. Proves
   champion is a *mutable field, not the identity* of the journey.
   → Dashboard **"Champion Rotated"** badge → Case File timeline.

4. **engineering / mobile-ios — "early warning."**
   At Risk: scope creep, adoption stalled at 50% vs a 70% target. Where **Champion Prep**
   shines — open items, unmet promises, questions to verify before the 1:1.

5. **qa / test-automation — "silence is a signal."**
   Stale: no update in 3 weeks even though work was going *well*. Shows staleness
   detection — the tool flags gone-quiet domains that would otherwise be forgotten.
   → Dashboard **Stale** metric → its Case File (last entry date).

6. **research / data-science — "the honest negative."**
   Output went **flat / down** — AI briefly made things *worse* before a pivot. The
   credibility card: the tool reports losses, not just wins.
   → Its Case File / the Exec Summary risks.

7. **infrastructure / security — "the high-severity model-feedback case."**
   Blocked + stale by a *safety-critical* hallucination (fabricated CVE versions). The
   cross-cutting model feedback handed to the model handler.
   → **Ask Box** or its Failures panel.

---

## Part 3 — Suggested 5-minute pitch walk

Start at `index.html`, then:

1. **Dashboard** — "this is my Monday morning: 7 domains, who needs attention, what's
   blocked / stale." Point at the metric cards + the attention panel.
2. Click **NLP Tooling** (Recent Updates) → its **Case File** → "here's a domain that was
   our worst — 3 model failures — and here's the remediation and the eval that cleared it."
3. Click **Log Weekly Entry** → "this is the 2-minute form a champion fills each week —
   that's where all this comes from."
4. Back to dashboard → **Platform Reliability** → "champion changed mid-stream, nothing
   was lost."
5. Open **Ask Box** → *"Which domains are blocked by model failures?"* → "I can
   interrogate everything in plain English."
6. End on **Exec Summary** → "and this is the report you'd get — generated, not
   hand-written."

That sequence hits all 6 screens and 4–5 of the domain stories.

---

## Notes / open items

- **Champion Prep** pages exist for 4 domains (backend-services, nlp-tooling,
  platform-reliability, mobile-ios) — enough to demo the concept; the remaining domains
  reuse the same pattern.
- This is throwaway pitch material backed by mock data (`data/mock_data.json`). It is
  not the operational system and will be deleted once the real build begins.
