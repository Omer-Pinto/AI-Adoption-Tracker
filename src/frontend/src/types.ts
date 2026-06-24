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
  | 'abandoned';

export type ArtifactType = 'agent' | 'skill' | 'hook' | 'context';

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

export interface Team {
  id: number;
  name: string;
  cc_baseline: string | null;
  baseline_date: string | null;
}

export interface Champion {
  id: number;
  name: string;
  team_id: number;
  start_date: string | null;
  end_date: string | null;
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
  champion_id: number;
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
}

export interface Artifact {
  id: number;
  team_id: number;
  domain_id: number | null; // null = general / team-wide (all-team gutter)
  name: string;
  type: ArtifactType;
  tags: ArtifactTag[];
  summary: string | null;
}

export interface ActionItem {
  id: number;
  report_id: number;
  domain_id: number | null;
  text: string;
  owner: string | null;
  due_date: string | null;
  resolved: boolean;
}

// ---- History rows (spec §5) ----

export interface TaskHistoryEntry {
  id: number;
  task_id: number;
  report_id: number;
  meeting_date: string;
  status_at_meeting: TaskStatus;
  change_note: string | null;
}

export interface ArtifactHistoryEntry {
  id: number;
  artifact_id: number;
  report_id: number;
  meeting_date: string;
  change_kind: ArtifactChangeKind;
  change_note: string | null;
}

// ---- Report JSON (spec §4) ----

export interface ReportTaskLine {
  task: string; // task name; backend resolves existing vs new against the DB
  status: TaskStatus;
  owner?: string;
  note?: string;
  finished_on?: string; // optional per-task finish-date override (YYYY-MM-DD)
}

export interface ReportArtifactLine {
  artifact: string; // artifact name; backend resolves existing vs new against the DB
  type?: ArtifactType;
  tags?: ArtifactTag[];
  change_kind?: ArtifactChangeKind;
  note?: string;
}

export interface ReportDomainBlock {
  domain: string;
  changes?: Partial<Pick<Domain, 'priority' | 'description'>>;
  tasks?: ReportTaskLine[];
  artifacts?: ReportArtifactLine[];
}

export interface ReportActionItemLine {
  text: string;
  owner?: string;
  domain?: string;
  due_date?: string;
}

export interface ReportJson {
  champion: string;
  meeting_date: string;
  participants?: string[];
  raw_notes: string;
  domains?: ReportDomainBlock[];
  /** Top-level team-wide artifacts (not assigned to any domain). */
  artifacts?: ReportArtifactLine[];
  action_items?: ReportActionItemLine[];
  discussion?: string;
  issues?: string;
}

export interface Report {
  id: number;
  champion_id: number;
  meeting_date: string;
  // JSON-encoded string on the wire (models.Report.report_json: str). Wave-2
  // does `JSON.parse(report.report_json) as ReportJson` to read the document.
  report_json: string;
  schema_version: number;
}

// ---- Composite view payloads (api_contract §2 — backend routes/views.py) ----

/** Task detail wrapper — `GET /api/tasks/{id}` (contract §2). */
export interface TaskDetail {
  task: Task;
  history: TaskHistoryEntry[];
}

/** Artifact detail wrapper — `GET /api/artifacts/{id}` (contract §2). */
export interface ArtifactDetail {
  artifact: Artifact;
  history: ArtifactHistoryEntry[];
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

/** One champion's portfolio, labeled by team — `GET /api/teams/{id}/page` (contract §2). */
export interface TeamPage {
  team: Team;
  champion: Champion;
  domains: DomainPage[];
  /** Un-domained, team-wide artifacts (the all-team gutter, domain_id = null). */
  all_team_artifacts: Artifact[];
  reports: Report[];
  action_items: ActionItem[];
}

/** Teams index row — `GET /api/team-pages` (contract §2). One per (team, champion). */
export interface TeamPageIndexEntry {
  team_id: number;
  team_name: string;
  champion_id: number;
  champion_name: string;
  domain_count: number;
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
