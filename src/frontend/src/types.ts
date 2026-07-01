// Domain types — conform to specs/api_contract.md and src/backend/models.py.
// These are the shared contract types consumed by Wave-2 page agents. The
// contract (Agent 0A) is authoritative; these types mirror it exactly,
// including field nullability from models.py (`str | None` → `string | null`).

// ---- Enums (spec §5) ----

export type TaskStatus =
  | 'planned'
  | 'in-progress'
  | 'finished_successfully'
  | 'finished_with_issues'
  | 'blocked'
  | 'abandoned'
  | 'wont_fix';

export type ArtifactType =
  | 'agent'
  | 'skill'
  | 'hook'
  | 'context'
  | 'workflow'
  | 'mcp'
  | 'other';

export type ArtifactChangeKind = 'added' | 'updated' | 'retired' | 'moved';

// Fixed tag set (spec §5) — free-text tags also allowed, so the type stays `string`.
export type ArtifactTag =
  | 'in_use_by_champ_only'
  | 'in_use_by_team'
  | 'under_test'
  | 'proved_worthy'
  | 'updated_periodically'
  | 'not_updated'
  | 'created_by_enablement_lead'
  | 'problematic'
  | (string & {});

// ---- Current-state entities (spec §5) ----

// One team = one champion (1:1). The champion is carried inline on the team as
// `champion_name` / `champion_start_date`; there is no standalone Champion entity.
export interface Team {
  id: number;
  name: string;
  champion_name: string;
  champion_start_date: string | null;
}

export interface CrossDomainRef {
  id: number;
  name: string;
  team_id: number;
  team_name: string;
}

export interface Domain {
  id: number;
  team_id: number;
  team_name: string;
  name: string;
  description: string | null;
  priority: string | null;
  cross_domains: CrossDomainRef[];
}

export interface Task {
  id: number;
  domain_id: number;
  name: string;
  status: TaskStatus;
  owner: string | null;
  started_on: string | null;
  ended_on: string | null;
  /** Wave-12 rename of the finish field. Additive; `ended_on` kept for deferred tidy. */
  due_date?: string | null;
}

export interface Artifact {
  id: number;
  team_id: number;
  // Always set — every artifact now belongs to a team domain (no team-wide gutter).
  domain_id: number;
  name: string;
  type: ArtifactType;
  tags: ArtifactTag[];
  summary: string | null;
}

export interface ActionItem {
  id: number;
  // An action item is the AI Lead's own to-do. `report_id` is null for a
  // standalone (self-managed) item, set when the item was folded from a report.
  report_id: number | null;
  // The item's team (nullable). Report-derived → the report's team; manual →
  // the team the AI Lead picked, or null (the "General" gutter). Replaces the
  // former per-item domain — an action item carries a TEAM, not a domain.
  team_id: number | null;
  text: string;
  /** Free-text note the AI Lead keeps on the item (A1+A2). Null = none. */
  note: string | null;
  due_date: string | null;
  status?: TaskStatus;
}

// ---- History rows (spec §5) ----

// `source` distinguishes a report-derived entry from a manual current-state
// edit (both ARE journaled now). `report_id` is null for a manual entry.
export interface TaskHistoryEntry {
  id: number;
  task_id: number;
  report_id: number | null;
  meeting_date: string;
  status_at_meeting: TaskStatus;
  owner: string | null;
  ended_on: string | null;
  /** Wave-12 rename of the finish field. Additive; `ended_on` kept for deferred tidy. */
  due_date?: string | null;
  change_note: string | null;
  source: 'report' | 'manual';
}

export interface ArtifactHistoryEntry {
  id: number;
  artifact_id: number;
  report_id: number | null;
  meeting_date: string;
  change_kind: ArtifactChangeKind;
  change_note: string | null;
  source: 'report' | 'manual';
}

// ---- Report JSON (spec §4) ----

// FLAT report shape (Waves 8/9) — mirrors src/backend/models.py exactly.
// `ReportDocument` has top-level `tasks` / `artifacts` / `action_items` lists;
// each line carries its own domain placement (`domain_id` + `domain`) and, for
// tasks/artifacts, an optional matched-entity `id`.
//
// id semantics (OPPOSITE of domain_id):
//   * `id` SET   → MATCHED existing task/artifact (the row's PK).
//   * `id` null  → a NEW task/artifact to create at fan-out time.
//   * `domain_id` SET  → matched existing domain (with `domain` = its name).
//   * `domain_id` null → UNPLACED (the per-champion "General" gutter);
//     it does NOT mint a domain.
//
// The backend has `extra="forbid"`: a saved line must carry ONLY these keys.

export interface ReportTaskLine {
  /** matched existing task PK; null/absent = NEW task to create. */
  id?: number | null;
  task: string;
  status: TaskStatus;
  owner?: string;
  note?: string;
  due_date?: string; // optional per-task due-date override (YYYY-MM-DD)
  domain_id?: number | null;
  domain?: string | null;
}

export interface ReportArtifactLine {
  /** matched existing artifact PK; null/absent = NEW artifact to create. */
  id?: number | null;
  artifact: string;
  type?: ArtifactType;
  tags?: ArtifactTag[];
  summary?: string;
  change_kind?: ArtifactChangeKind;
  note?: string;
  domain_id?: number | null;
  domain?: string | null;
}

export interface ReportActionItemLine {
  text: string;
  // An action item is the AI Lead's own to-do — it has no owner and NO domain.
  // Its team is implicit (the report's team), so nothing is carried on the line.
  // `note` is a free-text annotation folded into the stored item (A1+A2).
  note?: string;
  due_date?: string;
  status?: TaskStatus;
}

export interface ReportJson {
  champion: string;
  meeting_date: string;
  participants?: string[];
  raw_notes: string;
  tasks?: ReportTaskLine[];
  artifacts?: ReportArtifactLine[];
  action_items?: ReportActionItemLine[];
  // Ordered lists of free-text items (each entry one discussion point / one
  // issue; an item MAY itself contain newlines). Mirrors backend
  // `ReportDocument.discussion`/`.issues: list[str]` (default []).
  discussion?: string[];
  issues?: string[];
}

/** Picker-shaped team entity projection — `GET /api/teams/{team_id}/entities`. */
export interface EntityPickerTask {
  id: number;
  name: string;
  status: string;
  domain_id: number;
  domain: string | null;
}

export interface EntityPickerArtifact {
  id: number;
  name: string;
  type: ArtifactType;
  domain_id: number | null;
  domain: string | null;
}

export interface TeamEntities {
  tasks: EntityPickerTask[];
  artifacts: EntityPickerArtifact[];
}

export interface Report {
  id: number;
  team_id: number;
  meeting_date: string;
  // JSON-encoded string on the wire (models.Report.report_json: str). Wave-2
  // does `JSON.parse(report.report_json) as ReportJson` to read the document.
  report_json: string;
  schema_version: number;
}

// ---- Composite view payloads (api_contract §2 — backend routes/views.py) ----

/** Task detail wrapper — `GET /api/tasks/{id}` (contract §2). `domain` is the
 *  resolved domain name (null for an unknown domain), surfaced by the backend. */
export interface TaskDetail {
  task: Task;
  domain: string | null;
  history: TaskHistoryEntry[];
}

/** Artifact detail wrapper — `GET /api/artifacts/{id}` (contract §2). `domain` is
 *  the resolved domain name (every artifact belongs to a domain). */
export interface ArtifactDetail {
  artifact: Artifact;
  domain: string;
  history: ArtifactHistoryEntry[];
}

/** Body for `PATCH /api/tasks/{id}` — manager current-state edit (un-journaled).
 *  All of status / owner / domain_id / started_on / ended_on are editable
 *  (partial PATCH). A bad `status` enum → 422; `domain_id` must be non-null and
 *  same-team or it 422s. Manual edits here ARE journaled to task_history
 *  (source='manual', dated today). */
export interface TaskPatchBody {
  status?: TaskStatus;
  owner?: string | null;
  domain_id?: number;
  started_on?: string | null;
  ended_on?: string | null;
  /** Wave-12 rename of the finish field. Additive; `ended_on` kept for deferred tidy. */
  due_date?: string | null;
}

/** Body for `PATCH /api/artifacts/{id}` — every artifact belongs to a domain,
 *  so `domain_id` is a non-null domain PK. */
export interface ArtifactPatchBody {
  name?: string;
  type?: ArtifactType;
  tags?: string[];
  summary?: string | null;
  domain_id?: number;
}

/**
 * One domain's slice of a team page, and the full `GET /api/domains/{id}/page`
 * payload (contract §2). Current-state rows + separate ordered history arrays.
 * No team/champion embedded; tasks/artifacts are plain rows.
 */
export interface DomainPage {
  domain: Domain;
  tasks: Task[];
  task_history: TaskHistoryEntry[];
  artifacts: Artifact[];
  artifact_history: ArtifactHistoryEntry[];
}

/** One team's portfolio (its champion lives on `team.champion_name`) —
 *  `GET /api/teams/{id}/page` (contract §2). */
export interface TeamPage {
  team: Team;
  domains: DomainPage[];
  reports: Report[];
  action_items: ActionItem[];
  // Summary tallies over the page's loaded data (Wave 12). "Closed" = status in
  // the terminal set; "open" = everything else. Counts mirror routes/views.py.
  open_tasks: number;
  closed_tasks: number;
  open_action_items: number;
  closed_action_items: number;
  meeting_count: number;
  domain_count: number;
  artifact_count: number;
}

/** Teams index row — `GET /api/team-pages` (contract §2). One per team. */
export interface TeamPageIndexEntry {
  team_id: number;
  team_name: string;
  champion_name: string;
  domain_count: number;
}

/** One AI-Lead action item, flattened across ALL teams —
 *  `GET /api/ai-lead/action-items` (backend routes/views.py `AILeadActionItem`).
 *  Every action item is the AI Lead's (there is no owner), resolved against its
 *  report/champion and its own team. An action item carries a TEAM, not a
 *  domain: `team_id` is null (the "General" gutter) when unassigned, and
 *  `team_name` is derived from it (null → "General").
 *
 *  Two flavours, discriminated by `report_id` (equivalently `meeting_date`):
 *    * report-derived (`report_id` set) — mined from a champion report; team
 *      (from the report) / champion / meeting_date are set; fully editable here.
 *    * standalone (`report_id` null) — a self-managed item owned by the AI Lead;
 *      champion_name / meeting_date are null; team is picked here (or General). */
export interface AILeadActionItem {
  id: number;
  text: string;
  /** Free-text note the AI Lead keeps on the item (A1+A2). Null = none. */
  note: string | null;
  /** The item's team; null = the "General" gutter (unassigned). */
  team_id: number | null;
  /** Derived from `team_id` — the team's name, or null when General. */
  team_name: string | null;
  champion_name: string | null;
  meeting_date: string | null;
  status: TaskStatus;
  report_id: number | null;
  /** Target date the item is due; null = no due date set (never overdue). */
  due_date?: string | null;
}

/** Body for `PATCH /api/action-items/{id}` — partial; send only the changed
 *  field(s). A1+A2: EVERY action item (report-derived AND standalone) now
 *  supports full in-place edits — `text`, `status`, `due_date` (null clears it),
 *  `note` (null clears it) and `team_id` (null = the "General" gutter). No more
 *  409 on report-derived text edits. Returns the full updated bare `ActionItem`. */
export interface ActionItemPatchBody {
  status?: TaskStatus;
  due_date?: string | null;
  text?: string;
  note?: string | null;
  team_id?: number | null;
}

/** Body for `POST /api/action-items` — create a standalone AI-Lead-owned item.
 *  `text` is required + non-blank; `status` defaults to 'planned'. `note` and
 *  `team_id` are optional (A1+A2); `team_id` null = the "General" gutter. Returns
 *  the enriched `AILeadActionItem` (with null champion/meeting_date/report_id). */
export interface ActionItemCreateBody {
  text: string;
  status?: TaskStatus;
  due_date?: string | null;
  note?: string | null;
  team_id?: number | null;
}

// ---- AI-Lead toolkit (standalone resource — `/api/ai-lead/items`) ----
//
// The AI Lead's personal list of meta-skills + Claude Code enhancements,
// managed entirely on the AI-Lead page. NOT tied to any team/report.

export type AILeadItemCategory = 'meta_skill' | 'cc_enhancement';

export interface AILeadItem {
  id: number;
  name: string;
  description?: string | null;
  category: AILeadItemCategory;
}

/** Body for `POST /api/ai-lead/items` and `PATCH /api/ai-lead/items/{id}`
 *  (PATCH sends a partial subset). Blank name → 422 on create. */
export interface AILeadItemBody {
  name: string;
  description?: string | null;
  category: AILeadItemCategory;
}

// ---- Auth & RBAC (Wave 17) ----
//
// Login for ALL users. One `is_admin` reads+edits everything. Everyone else is
// read-only, scoped to either all teams (`read_all`) or an explicit `teams` list.
// `AuthUser` is the identity returned by login / `GET /api/auth/me`; `User` is the
// fuller admin-managed record (adds `id` + `is_active`) listed under `/api/users`.

/** The signed-in identity — `POST /api/auth/login`.user and `GET /api/auth/me`. */
export interface AuthUser {
  username: string;
  is_admin: boolean;
  /** Read-only visibility over every team (ignored for admins, who see all). */
  read_all: boolean;
  /** Explicitly-visible team ids (empty when `read_all`/admin grants all). */
  teams: number[];
}

/** An admin-managed user record — `GET /api/users` rows. */
export interface User {
  id: number;
  username: string;
  is_admin: boolean;
  read_all: boolean;
  is_active: boolean;
  teams: number[];
}

/** Response for `POST /api/auth/login` — bearer token + the caller's identity. */
export interface LoginResponse {
  token: string;
  user: AuthUser;
}

/** Body for `POST /api/users` — admin creates a user. */
export interface UserCreateBody {
  username: string;
  password: string;
  read_all?: boolean;
  teams?: number[];
  is_active?: boolean;
}

/** Body for `PATCH /api/users/{id}` — admin edits a user (partial).
 *  No `password` field: the backend `UserUpdate` model is `extra="forbid"` and
 *  rejects it (422). Password changes go only through reset-password. */
export interface UserUpdateBody {
  username?: string;
  read_all?: boolean;
  teams?: number[];
  is_active?: boolean;
}

// ---- Search autocomplete (api_contract §4 — `GET /api/search/values`) ----

export type SearchKey = 'team' | 'domain' | 'type' | 'tag' | 'status' | 'date';

export type SearchValueKind = 'enum' | 'free' | 'date' | 'numeric';

export interface SearchValue {
  value: string;
  label: string;
}

/** Tagged autocomplete result so the chip UI can render enum vs free vs date. */
export interface SearchValuesResult {
  key: SearchKey;
  kind: SearchValueKind;
  values: SearchValue[];
}
