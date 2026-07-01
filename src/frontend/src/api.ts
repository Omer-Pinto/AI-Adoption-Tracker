// Typed API client wired to the real backend (spec §7 endpoints).
//
// All methods use the `request<T>` helper which does
// `fetch(`${API_BASE}${path}`, ...)`, throws `ApiError` on non-2xx, and
// returns `res.json()`. Base URL points at the FastAPI dev server via the
// Vite `/api` proxy (see vite.config.ts).

import type {
  ActionItem,
  ActionItemCreateBody,
  ActionItemPatchBody,
  AILeadActionItem,
  AILeadItem,
  AILeadItemBody,
  Artifact,
  ArtifactDetail,
  ArtifactPatchBody,
  Domain,
  DomainPage,
  Report,
  ReportJson,
  SearchKey,
  SearchValuesResult,
  Task,
  TaskDetail,
  TaskPatchBody,
  Team,
  TeamEntities,
  TeamPage,
  TeamPageIndexEntry,
} from '@/types';

/** Shape accepted by POST /api/domains and PATCH /api/domains/{id}. */
export interface DomainWriteBody {
  team_id: number;
  name: string;
  description?: string | null;
  priority?: string | null;
  cross_domain_ids?: number[];
}

/** One item returned by POST /api/domains/extract (not yet saved). */
export interface DomainProposal {
  name: string;
  description: string | null;
  priority: string | null;
}

export const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    // Try to read FastAPI's `{"detail": "..."}` body for a user-facing message.
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (body.detail !== undefined) detail = JSON.stringify(body.detail);
    } catch {
      // ignore JSON parse failures
    }
    throw new ApiError(
      res.status,
      detail ?? `${init?.method ?? 'GET'} ${path} → ${res.status}`,
    );
  }
  // DELETE endpoints return 204 No Content (empty body); tolerate that —
  // and stay robust if the backend later returns a JSON body.
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  // ---- Meta ----
  health: (): Promise<{ status: string; version: string }> => request('/health'),
  // ---- Management (backend routes/management.py — task_breakdown 1A) ----
  teams: {
    list: (): Promise<Team[]> => request('/teams'),
    create: (body: Omit<Team, 'id'>): Promise<Team> =>
      request('/teams', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: Partial<Omit<Team, 'id'>>): Promise<Team> =>
      request(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  domains: {
    list: (): Promise<Domain[]> => request('/domains'),
    /** Filter domains by team — `GET /api/domains?team_id=<id>` (entity edit picker). */
    listByTeam: (teamId: number): Promise<Domain[]> =>
      request(`/domains?team_id=${encodeURIComponent(String(teamId))}`),
    create: (body: DomainWriteBody): Promise<Domain> =>
      request('/domains', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: Partial<DomainWriteBody>): Promise<Domain> =>
      request(`/domains/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    /** POST /api/domains/extract — LLM extraction, returns proposals (not saved). */
    extract: (text: string): Promise<{ domains: DomainProposal[] }> =>
      request('/domains/extract', { method: 'POST', body: JSON.stringify({ text }) }),
    delete: (id: number): Promise<void> =>
      request(`/domains/${id}`, { method: 'DELETE' }),
  },

  // ---- Views & lists (backend routes/views.py — task_breakdown 1B) ----
  views: {
    // Landing teams index — `GET /api/team-pages` (one entry per team/champion).
    teamsIndex: (): Promise<TeamPageIndexEntry[]> => request('/team-pages'),
    // `{id}` is the TEAM id (the page is keyed by team; its champion is labeled inline).
    teamPage: (teamId: number): Promise<TeamPage> => request(`/teams/${teamId}/page`),
    domainPage: (domainId: number): Promise<DomainPage> => request(`/domains/${domainId}/page`),
    tasks: (q?: string): Promise<Task[]> =>
      request(q ? `/tasks?q=${encodeURIComponent(q)}` : '/tasks'),
    // `GET /api/tasks/{id}` → { task, history } wrapper.
    task: (taskId: number): Promise<TaskDetail> => request(`/tasks/${taskId}`),
    artifacts: (q?: string): Promise<Artifact[]> =>
      request(q ? `/artifacts?q=${encodeURIComponent(q)}` : '/artifacts'),
    // `GET /api/artifacts/{id}` → { artifact, history } wrapper.
    artifact: (artifactId: number): Promise<ArtifactDetail> => request(`/artifacts/${artifactId}`),
    // `PATCH /api/tasks/{id}` — entity-page edit (owner, domain_id only). Returns updated Task.
    patchTask: (taskId: number, body: TaskPatchBody): Promise<Task> =>
      request(`/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // `PATCH /api/artifacts/{id}` — entity-page edit. Returns updated Artifact.
    patchArtifact: (artifactId: number, body: ArtifactPatchBody): Promise<Artifact> =>
      request(`/artifacts/${artifactId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // `GET /api/teams/{team_id}/entities` — picker-shaped tasks + artifacts for the
    // report editor's @-task / #-artifact mentions and link-existing pickers.
    teamEntities: (teamId: number): Promise<TeamEntities> =>
      request(`/teams/${teamId}/entities`),
  },

  // ---- Reports (backend routes/reports.py — task_breakdown 1C) ----
  reports: {
    // raw notes → drafted structured report (NOT saved). The only create path (spec §4).
    // Backend DraftRequest shape: { team_id, notes } (snake_case).
    draft: (teamId: number, notes: string): Promise<ReportJson> =>
      request('/reports/draft', {
        method: 'POST',
        body: JSON.stringify({ team_id: teamId, notes }),
      }),
    // confirm/save: fan out to tables in one transaction. The team is passed as a
    // query param (`?team_id=`); the body is the report document. Returns { report }.
    create: (teamId: number, body: ReportJson): Promise<{ report: Report }> =>
      request(`/reports?team_id=${teamId}`, { method: 'POST', body: JSON.stringify(body) }),
    // `GET /api/reports/{id}` → { report } wrapper (binds the edit form).
    get: (reportId: number): Promise<{ report: Report }> => request(`/reports/${reportId}`),
    // edit a saved report → PATCH → replay. Returns { report } wrapper.
    update: (reportId: number, body: ReportJson): Promise<{ report: Report }> =>
      request(`/reports/${reportId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  // ---- Search autocomplete (backend routes/search.py — task_breakdown 1D) ----
  search: {
    // `GET /api/search/values?key=...` → tagged { key, kind, values }.
    values: (key: SearchKey): Promise<SearchValuesResult> =>
      request(`/search/values?key=${encodeURIComponent(key)}`),
  },

  // ---- AI-Lead dashboard (backend routes/views.py — Wave 12/13) ----
  aiLead: {
    // `GET /api/ai-lead/action-items` — every AI-Lead-owned action item (owner =
    // 'AI Lead') across ALL teams, of any status, newest first.
    actionItems: (): Promise<AILeadActionItem[]> => request('/ai-lead/action-items'),
    // `PATCH /api/action-items/{id}` — partial edit (status, due_date, text, note
    // and/or domain_id). A1+A2: works on EVERY item (report-derived AND
    // standalone) — no 409 on text edits. Returns the full updated bare
    // ActionItem, so callers reconcile their list row from the returned fields.
    patch: (id: number, body: ActionItemPatchBody): Promise<ActionItem> =>
      request(`/action-items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // `POST /api/action-items` — create a standalone AI-Lead item (201 → enriched
    // row, with null team/champion/meeting_date/report_id). Append it directly.
    create: (body: ActionItemCreateBody): Promise<AILeadActionItem> =>
      request('/action-items', { method: 'POST', body: JSON.stringify(body) }),
    // `DELETE /api/action-items/{id}` — A1+A2: deletes ANY item (204; no 409).
    delete: (id: number): Promise<void> =>
      request(`/action-items/${id}`, { method: 'DELETE' }),
    // ---- Personal toolkit (standalone resource — `/api/ai-lead/items`) ----
    // Meta-skills + Claude Code enhancements; no teams/reports involved.
    items: {
      // `GET /api/ai-lead/items` — every toolkit item.
      list: (): Promise<AILeadItem[]> => request('/ai-lead/items'),
      // `POST /api/ai-lead/items` — create (201; blank name → 422).
      create: (body: AILeadItemBody): Promise<AILeadItem> =>
        request('/ai-lead/items', { method: 'POST', body: JSON.stringify(body) }),
      // `PATCH /api/ai-lead/items/{id}` — partial edit (404 if missing).
      update: (id: number, body: Partial<AILeadItemBody>): Promise<AILeadItem> =>
        request(`/ai-lead/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
      // `DELETE /api/ai-lead/items/{id}` — 204 No Content.
      delete: (id: number): Promise<void> =>
        request(`/ai-lead/items/${id}`, { method: 'DELETE' }),
    },
  },
};

export { ApiError, request };
