# Payments Platform — setup

**Team display name:** `Payments Platform` (folder = team name)
**Champion(s):** `Maya` (single champion)

## What Omer creates MANUALLY (Manage page)
- The **team** `Payments Platform`.
- The **champion** `Maya` under that team.
- (Optional) `team.cc_baseline` / "Current Claude Code status" — free text, not exercised here.

## What is created via the LLM "Smart domain extract" flow
Paste the block below into **Smart domain extract** for champion **Maya**, then accept the
proposals. Do NOT type these by hand — the point is to exercise the extractor + the
`Priority Order:` arrow-mapping logic.

```
1. Payments Core - go, grpc, postgres, ledger, idempotency, refunds, money movement
2. Risk & Fraud - python, ml models, feature store, rules engine, scoring
3. Infrastructure - terraform, aws, kubernetes, helm, ci/cd
4. Observability - datadog, prometheus, pagerduty, on-call, alerting
Priority Order: 1 -> 2 -> 4 -> 3
```

**Expected extract result** (priority arrow maps over LIST POSITIONS, not top-to-bottom):
- Payments Core → priority **1**
- Risk & Fraud → priority **2**
- Observability → priority **3**  (4th listed, but 3rd in the arrow sequence)
- Infrastructure → priority **4** (3rd listed, but 4th in the arrow sequence)

## Auto-created domains (do NOT add these)
Two constant domains are minted automatically per champion the first time you draft a
report — do not create or list them:
- **General** — the unplaced/fallback bucket (priority null).
- **Context creation** — a REAL placement target (priority "1") for CLAUDE.md / context
  files / conventions.

## Feed order for this champion
Save each report before drafting the next (the LLM only sees PRIOR-saved tasks/artifacts):
`20260504` → `20260511` → `20260518`.
