// Typed API client, stubbed to the backend contract shape (spec §7 endpoints).
//
// SHAPES ARE AUTHORITATIVE; IMPLEMENTATIONS ARE STUBS. Wave-2 agents replace the
// stub bodies with real `request()` calls — the method signatures and return
// types here mirror specs/spec.md §7 (and will mirror specs/api_contract.md once
// the backend agent commits it). Base URL points at the FastAPI dev server via
// the Vite `/api` proxy (see vite.config.ts).

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
} from './types';

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
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Marker used by stub methods so Wave-2 agents can grep for what is unimplemented.
// The explicit return type <T> is set at each call site; the (ignored) args just
// keep parameter names referenced so noUnusedParameters stays happy.
function stub<T>(..._args: unknown[]): Promise<T> {
  return Promise.reject(new Error('api.ts: stub — wire the real backend call (Wave 2)'));
}

export const api = {
  // ---- Management (backend routes/management.py — task_breakdown 1A) ----
  teams: {
    list: (): Promise<Team[]> => stub(),
    create: (body: Omit<Team, 'id'>): Promise<Team> => stub(body),
    update: (id: number, body: Partial<Omit<Team, 'id'>>): Promise<Team> => stub(id, body),
  },
  champions: {
    list: (): Promise<Champion[]> => stub(),
    create: (body: Omit<Champion, 'id'>): Promise<Champion> => stub(body),
    update: (id: number, body: Partial<Omit<Champion, 'id'>>): Promise<Champion> => stub(id, body),
  },
  domains: {
    list: (): Promise<Domain[]> => stub(),
    create: (body: Omit<Domain, 'id'>): Promise<Domain> => stub(body),
    update: (id: number, body: Partial<Omit<Domain, 'id'>>): Promise<Domain> => stub(id, body),
  },

  // ---- Views & lists (backend routes/views.py — task_breakdown 1B) ----
  views: {
    // Landing teams index — `GET /api/team-pages` (one entry per team/champion).
    teamsIndex: (): Promise<TeamPageIndexEntry[]> => stub(),
    teamPage: (championId: number): Promise<TeamPage> => stub(championId),
    domainPage: (domainId: number): Promise<DomainPage> => stub(domainId),
    tasks: (q?: string): Promise<Task[]> => stub(q),
    // `GET /api/tasks/{id}` → { task, history } wrapper.
    task: (taskId: number): Promise<TaskDetail> => stub(taskId),
    artifacts: (q?: string): Promise<Artifact[]> => stub(q),
    // `GET /api/artifacts/{id}` → { artifact, history } wrapper.
    artifact: (artifactId: number): Promise<ArtifactDetail> => stub(artifactId),
  },

  // ---- Reports (backend routes/reports.py — task_breakdown 1C) ----
  reports: {
    // raw notes → drafted structured report (NOT saved). The only create path (spec §4).
    draft: (notes: string, championId: number): Promise<ReportJson> => stub(notes, championId),
    // confirm/save: fan out to tables in one transaction. Returns { report } wrapper.
    create: (body: ReportJson): Promise<{ report: Report }> => stub(body),
    // `GET /api/reports/{id}` → { report } wrapper (binds the edit form).
    get: (reportId: number): Promise<{ report: Report }> => stub(reportId),
    // edit a saved report → PATCH → replay. Returns { report } wrapper.
    update: (reportId: number, body: ReportJson): Promise<{ report: Report }> =>
      stub(reportId, body),
  },

  // ---- Search autocomplete (backend routes/search.py — task_breakdown 1D) ----
  search: {
    // `GET /api/search/values?key=...` → tagged { key, kind, values }.
    values: (key: SearchKey): Promise<SearchValuesResult> => stub(key),
  },
};

export { ApiError, request };
