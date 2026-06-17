// Domain types — mirror spec.md §4 (report JSON) and §5 (data model).
// These are the shared contract types consumed by Wave-2 page agents.
// Derived from specs/spec.md because specs/api_contract.md did not yet exist
// at scaffold time (backend Agent 0A writes it in parallel).

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
  cc_baseline: string;
  baseline_date: string | null;
}

export interface Champion {
  id: number;
  name: string;
  team_id: number;
  start_date: string;
  end_date: string | null;
}

export interface Domain {
  id: number;
  team_id: number;
  champion_id: number;
  name: string;
  description: string;
  scope: string;
  priority: number;
  cross_domain: string;
}

export interface Task {
  id: number;
  domain_id: number;
  name: string;
  status: TaskStatus;
  owner: string;
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
  summary: string;
}

export interface ActionItem {
  id: number;
  report_id: number;
  domain_id: number | null;
  text: string;
  owner: string;
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
  change_note: string;
}

export interface ArtifactHistoryEntry {
  id: number;
  artifact_id: number;
  report_id: number;
  meeting_date: string;
  change_kind: ArtifactChangeKind;
  change_note: string;
}

// ---- Report JSON (spec §4) ----

export interface ReportTaskLine {
  task?: string; // existing task name
  new_task?: string; // newly introduced task name
  status: TaskStatus;
  owner?: string;
  note?: string;
}

export interface ReportArtifactLine {
  artifact?: string; // existing artifact name
  new_artifact?: string; // newly introduced artifact name
  type?: ArtifactType;
  tags?: ArtifactTag[];
  change_kind?: ArtifactChangeKind;
  note?: string;
}

export interface ReportDomainBlock {
  domain: string;
  changes?: Partial<Pick<Domain, 'priority' | 'description' | 'scope' | 'cross_domain'>>;
  tasks: ReportTaskLine[];
  artifacts: ReportArtifactLine[];
}

export interface ReportActionItemLine {
  text: string;
  owner: string;
  due_date?: string;
}

export interface ReportJson {
  champion: string;
  meeting_date: string;
  participants: string[];
  raw_notes: string;
  domains: ReportDomainBlock[];
  action_items: ReportActionItemLine[];
  discussion: string;
  issues: string;
}

export interface Report {
  id: number;
  champion_id: number;
  meeting_date: string;
  report_json: ReportJson;
  schema_version: number;
}

// ---- Composite view payloads (spec §7, §8 — backend views.py) ----

/** A task plus its week-by-week journey (spec §6 read-back). */
export interface TaskWithHistory extends Task {
  history: TaskHistoryEntry[];
}

/** An artifact plus its change history — feeds ArtifactDetailModal (spec §7). */
export interface ArtifactWithHistory extends Artifact {
  history: ArtifactHistoryEntry[];
}

/** A domain bundled with its current state + story (domain page). */
export interface DomainPage {
  domain: Domain;
  team: Team;
  champion: Champion;
  tasks: TaskWithHistory[];
  artifacts: ArtifactWithHistory[];
}

/** One champion's portfolio, labeled by team (team page, spec §7). */
export interface TeamPage {
  team: Team;
  champion: Champion;
  domains: DomainPage[];
  /** Un-domained, team-wide artifacts (all-team gutter). */
  gutter_artifacts: ArtifactWithHistory[];
  reports: Report[];
  action_items: ActionItem[];
}

/** Teams index row (spec §7 — list of champion portfolios). */
export interface TeamIndexEntry {
  team: Team;
  champion: Champion;
  domains: Domain[];
}

// ---- Search autocomplete (spec §7 search bar) ----

export type SearchKey = 'team' | 'domain' | 'type' | 'tag' | 'status' | 'date';

export interface SearchValue {
  value: string;
  label: string;
}
