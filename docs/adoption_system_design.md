# Personal Adoption Tracker: Tight Design

**Purpose:** Omer's personal command-center to track Claude Code adoption across ~10–20 Team × Domain leaves, driven by weekly champion meetings. Outputs: personal source of truth + generated executive projection for manager.

## Goals & Non-Goals

- **Goals:** capture free narrative + structured facts weekly per leaf · synthesize into executive summaries · detect anomalies (stale leaves, blocked tasks, quality issues) · provide mutable champion field + artifact lifecycle.
- **Non-Goals:** NOT platform analytics · NOT model-evals effort · NOT a graph (at 10–20 domains × weekly × weeks, flat entry reading + LLM synthesis beats community detection; deferred indefinitely).

## Data Model

| Entity | Purpose | Key Fields |
|--------|---------|-----------|
| **Leaf** | Atomic unit (Team × Domain) | id, path (team/domain), lead_email, champion_email (mutable), target_task, created_at |
| **Weekly Entry** | Per-leaf transactional log | leaf_id, week_of, narrative (free-form), target_task_progress (enum: no_change / moved_forward / blocked / complete), observed_direction (enum: up / flat / down), current_mode (free string / tags), champion_facilitation (text), blockers, next_step |
| **Artifact** | Artifact lifecycle (skills, agents, hooks, context-files, workflows, evals) | name, type, entry_id (added/retired), reason_retired |
| **Failure** | Model/quality failures | entry_id, description, remediation_plan, owner, due_date |
| **Eval** | Candidate evaluation log | entry_id, artifact_name, pass/fail, notes |

**Champion Signals (internal smell-detection only, never ranking people):** facilitation text word-count, artifact adoption counts, frequency of being listed. Explicit: "Champion signals detect needs, not merit."

## UI / Consumption Model

1. **Dashboard / Command Center:** Where to look today? Metric cards: Active Domains, Stale Domains, Blocked Tasks, New Artifacts This Week, Model Failures, Candidate Evals. Panels: Domains Needing Attention (badges: Blocked / At Risk / Champion rotated / scope creep), Recent Updates, Top Artifacts. "Generate Weekly Summary" button. Left nav: Home, Domains, Artifacts, Failures, Evaluations, Reports, Ask Box, Settings.

2. **Domain Case File:** Single leaf view. Header: Team/Domain, status badge, champion, target task, started date. Tabs: Overview (latest entry + progress), Timeline (all entries), Artifacts (added/retired), Failures (log + remediation pipeline), Evaluations, Notes. Overview shows At-a-Glance sidebar (total weeks, entries, artifacts delta, failures, evals) + next step.

3. **Weekly Logging Flow:** Per-domain form (THE weekly report). Fields: Narrative (rich text), Target Task Progress, Observed Direction, Current Mode, Artifacts Added (name + type), Artifacts Retired (name + reason), Champion Facilitation, Blockers, Next Step. Save / Cancel. Week selector.

4. **Champion Meeting Prep:** Everything before 1:1. Tabs: Prep Overview, Open Items, Changes This Week, Questions to Verify. Last-meeting promises (checklist), unresolved failures, open items with due dates, recent artifact changes, questions. "Start Meeting" button.

5. **Operational Query / Ask Box:** Free-text question over all data; returns answer + supporting table. Suggested chips: "Artifacts retired & why?", "Domains without update 2+ weeks?", "Domains blocked by model failures?"

6. **Executive Projection (Generated):** Manager summary. Cards: Overall Health, At Risk, Blocked, Strong Examples. Sections: Highlights, Top Risks, Top Domains (with status), Recommended Actions. Generated via LLM from raw entries.

## Artifact & Failure Lifecycle

| Event | Flow | Outcome |
|-------|------|---------|
| **Artifact Added** | Weekly entry → name, type, adoption_count | Tracked in Artifacts table |
| **Artifact Retired** | Weekly entry → name, reason | Marked retired; triggers review if quality-related |
| **Failure Logged** | Weekly entry / Failures screen → description + owner | Enters remediation queue |
| **Remediation Assigned** | PM / Champion assigns task + due date | Tracked in Failures; linked to candidate eval |
| **Candidate Eval** | Weekly entry → artifact + pass/fail | Evaluations table; informs re-adoption decision |

## LLM Layer

- **Ask Box:** Free-text query + entry context → Claude API (user's air-gapped endpoint) → answer + supporting facts.
- **Exec Generation:** All entries for period → Claude → structured summary (leaf status, risks, cross-leaf patterns, org health).
- Screens 1–4: ZERO AI. Screens 5–6: LLM-driven.

## Database Schema

SQLite tables (normalized, nullable fields as noted):

**leaf**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | |
| path | TEXT UNIQUE | team/domain identifier |
| lead_email | TEXT | |
| champion_email | TEXT | mutable; current champion |
| target_task | TEXT | single responsibility |
| created_at | TEXT ISO8601 | |

**weekly_entry**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | |
| leaf_id | INTEGER FK | references leaf.id |
| week_of | TEXT ISO8601 | Monday of week |
| narrative | TEXT | free-form update |
| target_task_progress | TEXT ENUM | no_change, moved_forward, blocked, complete |
| observed_direction | TEXT ENUM NULL | up, flat, down |
| current_mode | TEXT | free tags/notes |
| champion_facilitation | TEXT | activities performed |
| blockers | TEXT | obstacles; null if none |
| next_step | TEXT | planned action |
| created_at | TEXT ISO8601 | |

**artifact**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | |
| entry_id | INTEGER FK | references weekly_entry.id (added/retired moment) |
| name | TEXT | artifact name |
| type | TEXT ENUM | skill, agent, hook, context_file, workflow, eval |
| is_retired | BOOLEAN | false=added, true=retired |
| reason_retired | TEXT NULL | retirement reason; null if active |

**failure**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | |
| entry_id | INTEGER FK | references weekly_entry.id |
| description | TEXT | what failed |
| remediation_plan | TEXT NULL | corrective action |
| owner | TEXT NULL | responsible person |
| due_date | TEXT ISO8601 NULL | target fix date |

**eval**
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PRIMARY KEY | |
| entry_id | INTEGER FK | references weekly_entry.id |
| artifact_name | TEXT | artifact being evaluated |
| passed | BOOLEAN | true=pass, false=fail |
| notes | TEXT | evaluation details |

## API / Endpoints

FastAPI resource-oriented contract. All requests/responses JSON. Base: `/api`.

**Leaves**
- `GET /leaves` — list all leaves + latest status
- `GET /leaves/{id}` — leaf detail + metadata
- `PATCH /leaves/{id}` — update champion_email or target_task
- `POST /leaves` — create new leaf

**Weekly Entries**
- `GET /leaves/{leaf_id}/entries` — all entries for leaf (time-sorted)
- `GET /leaves/{leaf_id}/entries/{week_of}` — specific week entry
- `POST /leaves/{leaf_id}/entries` — create/upsert weekly entry; payload: narrative, target_task_progress, observed_direction, current_mode, champion_facilitation, blockers, next_step
- `PATCH /leaves/{leaf_id}/entries/{week_of}` — update existing entry

**Artifacts**
- `GET /artifacts` — all artifacts across all leaves; filter by type/is_retired
- `GET /leaves/{leaf_id}/artifacts` — artifacts for single leaf
- Artifact lifecycle embedded in weekly entry POST (name, type, is_retired, reason_retired)

**Failures**
- `GET /failures` — all failures + remediation status; filter by owner/due_date
- `GET /leaves/{leaf_id}/failures` — failures for leaf
- `POST /leaves/{leaf_id}/failures` — log new failure; payload: description, remediation_plan, owner, due_date
- `PATCH /failures/{id}` — update remediation_plan, owner, due_date

**Evaluations**
- `GET /evals` — all candidate evals; filter by artifact_name/passed
- `GET /leaves/{leaf_id}/evals` — evals for leaf
- `POST /leaves/{leaf_id}/evals` — log candidate eval; payload: artifact_name, passed, notes

**Dashboard Aggregates**
- `GET /dashboard` — returns: active_leaves_count, stale_leaves_count (no entry > 2 weeks), blocked_tasks_count, new_artifacts_this_week_count, failures_count, evals_pending_count, domains_needing_attention (flags: blocked/at_risk/champion_rotated)

**LLM Endpoints**
- `POST /ask` — free-text query; payload: {query, leaf_ids_filter?}; returns: {answer, supporting_facts (list of entries)}. Calls user's air-gapped Claude endpoint.
- `POST /exec` — generate executive summary; payload: {start_date, end_date, ?}; returns: {health_cards, highlights, risks, recommended_actions}. Calls user's air-gapped Claude endpoint.

**Screen Mapping:**
- Dashboard (1): `/dashboard`, `/leaves`
- Domain Case File (2): `/leaves/{id}`, `/leaves/{id}/entries`, `/leaves/{id}/artifacts`, `/leaves/{id}/failures`, `/leaves/{id}/evals`
- Weekly Logging (3): `POST /leaves/{leaf_id}/entries`
- Champion Meeting Prep (4): `/leaves/{id}`, `/failures`, `/evals` (status-filtered)
- Ask Box (5): `POST /ask`
- Executive Projection (6): `POST /exec`

## Stack

**Backend:** SQLite (local, self-hosted) + FastAPI (Python). **Frontend:** React/Vite. **LLM:** User provides API endpoint to air-gapped Claude models.

**Visual Spec:** `mockups.png` is the canonical 6-screen UI mockup; all screens described above align with their respective mockup panels.

## MVP Scope & Phasing

| Screen | Phase | Needs AI? | Notes |
|--------|-------|-----------|-------|
| 1. Dashboard | 1 | No | Metric cards + panels from DB queries |
| 2. Domain Case File | 1 | No | Tabs + history view |
| 3. Weekly Logging | 1 | No | Form → DB insert |
| 4. Champion Meeting Prep | 1 | No | Checklist + open items |
| 5. Ask Box | 2 | Yes | Free-text query synthesis |
| 6. Exec Projection | 2 | Yes | LLM summarization + card generation |

**Week 1 Delivery:** Screens 1–4 + SQLite schema + FastAPI endpoints + React UI. **Week 2+:** LLM integration (screens 5–6).

---

**Data retention & backups:** SQLite file in `~/.local/adoption/adoption.db`. Weekly manual export to JSON for audit trail.
