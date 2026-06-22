// Typed API client wired to the real backend (spec §7 endpoints).
//
// All methods use the `request<T>` helper which does
// `fetch(`${API_BASE}${path}`, ...)`, throws `ApiError` on non-2xx, and
// returns `res.json()`. Base URL points at the FastAPI dev server via the
// Vite `/api` proxy (see vite.config.ts).

import type {
  Artifact,
  ArtifactDetail,
  Champion,
  Domain,
  DomainPage,
  Report,
  ReportJson,
  SearchKey,
  SearchValuesResult,
  Task,
  TaskDetail,
  Team,
  TeamPage,
  TeamPageIndexEntry,
} from '@/types';

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
  return res.json() as Promise<T>;
}

export const api = {
  // ---- Management (backend routes/management.py — task_breakdown 1A) ----
  teams: {
    list: (): Promise<Team[]> => request('/teams'),
    create: (body: Omit<Team, 'id'>): Promise<Team> =>
      request('/teams', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: Partial<Omit<Team, 'id'>>): Promise<Team> =>
      request(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  champions: {
    list: (): Promise<Champion[]> => request('/champions'),
    create: (body: Omit<Champion, 'id'>): Promise<Champion> =>
      request('/champions', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: Partial<Omit<Champion, 'id'>>): Promise<Champion> =>
      request(`/champions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },
  domains: {
    list: (): Promise<Domain[]> => request('/domains'),
    /** Filter domains by champion — `GET /api/domains?champion_id=<id>` */
    listByChampion: (championId: number): Promise<Domain[]> =>
      request(`/domains?champion_id=${encodeURIComponent(String(championId))}`),
    create: (body: Omit<Domain, 'id'>): Promise<Domain> =>
      request('/domains', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: number, body: Partial<Omit<Domain, 'id'>>): Promise<Domain> =>
      request(`/domains/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  },

  // ---- Views & lists (backend routes/views.py — task_breakdown 1B) ----
  views: {
    // Landing teams index — `GET /api/team-pages` (one entry per team/champion).
    teamsIndex: (): Promise<TeamPageIndexEntry[]> => request('/team-pages'),
    // `{id}` is the CHAMPION id (the page is keyed by champion, labeled by team).
    teamPage: (championId: number): Promise<TeamPage> => request(`/teams/${championId}/page`),
    domainPage: (domainId: number): Promise<DomainPage> => request(`/domains/${domainId}/page`),
    tasks: (q?: string): Promise<Task[]> =>
      request(q ? `/tasks?q=${encodeURIComponent(q)}` : '/tasks'),
    // `GET /api/tasks/{id}` → { task, history } wrapper.
    task: (taskId: number): Promise<TaskDetail> => request(`/tasks/${taskId}`),
    artifacts: (q?: string): Promise<Artifact[]> =>
      request(q ? `/artifacts?q=${encodeURIComponent(q)}` : '/artifacts'),
    // `GET /api/artifacts/{id}` → { artifact, history } wrapper.
    artifact: (artifactId: number): Promise<ArtifactDetail> => request(`/artifacts/${artifactId}`),
  },

  // ---- Reports (backend routes/reports.py — task_breakdown 1C) ----
  reports: {
    // raw notes → drafted structured report (NOT saved). The only create path (spec §4).
    // Backend DraftRequest shape: { champion_id, notes } (snake_case).
    draft: (notes: string, championId: number): Promise<ReportJson> =>
      request('/reports/draft', {
        method: 'POST',
        body: JSON.stringify({ champion_id: championId, notes }),
      }),
    // confirm/save: fan out to tables in one transaction. Returns { report } wrapper.
    create: (body: ReportJson): Promise<{ report: Report }> =>
      request('/reports', { method: 'POST', body: JSON.stringify(body) }),
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
};

export { ApiError, request };
