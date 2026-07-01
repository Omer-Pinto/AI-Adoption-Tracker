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
  AuthUser,
  Domain,
  DomainPage,
  LoginResponse,
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
  User,
  UserCreateBody,
  UserUpdateBody,
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

// ---- Auth token (Wave 17) ----
// The bearer token lives in localStorage and is mirrored in a module-level var so
// `request` can inject it synchronously without a localStorage read per call. The
// AuthContext owns the lifecycle and calls `setAuthToken` on login/logout/rehydrate.
const TOKEN_KEY = 'aat_token';
let authToken: string | null = localStorage.getItem(TOKEN_KEY);

/** Set (or clear, with `null`) the bearer token; keeps localStorage in sync. */
export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Current bearer token, or `null` when signed out. */
export function getAuthToken(): string | null {
  return authToken;
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A 403 from the backend — the caller is authenticated but not permitted. Thrown
 *  distinctly so the router/pages can render the Forbidden page instead of login. */
class ForbiddenError extends ApiError {
  constructor(message: string) {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
    // Global 401: an expired/invalid session — drop the token and bounce to login.
    // The login call itself 401s on bad creds; skip the redirect there so the form
    // can show its own error.
    if (res.status === 401 && path !== '/auth/login') {
      setAuthToken(null);
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    if (res.status === 403) {
      throw new ForbiddenError(
        detail ?? `${init?.method ?? 'GET'} ${path} → 403`,
      );
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

  // ---- Auth (backend routes/auth.py — Wave 17) ----
  auth: {
    // `POST /api/auth/login` → { token, user }. 401 on bad credentials (the form
    // catches it; the global 401 redirect is suppressed for this path).
    login: (username: string, password: string): Promise<LoginResponse> =>
      request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    // `POST /api/auth/logout` (Bearer) → 204.
    logout: (): Promise<void> => request('/auth/logout', { method: 'POST' }),
    // `GET /api/auth/me` (Bearer) → the caller's identity (rehydrate on load).
    me: (): Promise<AuthUser> => request('/auth/me'),
    // `POST /api/auth/change-password` (Bearer) → 204.
    changePassword: (oldPassword: string, newPassword: string): Promise<void> =>
      request('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      }),
  },

  // ---- Users (admin-only; backend routes/users.py — Wave 17) ----
  // Consumed by a later agent's admin user-portal page.
  users: {
    // `GET /api/users` → every user.
    list: (): Promise<User[]> => request('/users'),
    // `POST /api/users` → 201 with the created user.
    create: (body: UserCreateBody): Promise<User> =>
      request('/users', { method: 'POST', body: JSON.stringify(body) }),
    // `PATCH /api/users/{id}` → the updated user.
    update: (id: number, body: UserUpdateBody): Promise<User> =>
      request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    // `DELETE /api/users/{id}` → 204.
    delete: (id: number): Promise<void> =>
      request(`/users/${id}`, { method: 'DELETE' }),
    // `POST /api/users/{id}/reset-password` → 200 with the updated User. When
    // `newPassword` is omitted, send an empty body so the backend resets to the
    // provisioning default password.
    resetPassword: (id: number, newPassword?: string): Promise<User> =>
      request(`/users/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify(
          newPassword !== undefined ? { new_password: newPassword } : {},
        ),
      }),
  },
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
    // `GET /api/ai-lead/action-items` — every action item across ALL teams (all
    // are the AI Lead's; there is no owner filter), of any status, newest first.
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

export { ApiError, ForbiddenError, request };
