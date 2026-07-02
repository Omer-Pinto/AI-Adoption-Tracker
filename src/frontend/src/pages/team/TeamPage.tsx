import './team-page.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, Navigate } from 'react-router-dom';
import { api, ForbiddenError } from '@/api';
import type {
  TeamPage,
  DomainPage,
  Artifact,
  Task,
  TaskStatus,
} from '@/types';
import { StatusBadge, ArtifactTypeBadge, TagList } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { DomainStory } from '@/components/DomainStory';
import { CountUp } from '@/components/CountUp';
import { ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';
import { isScopedChampion } from '@/auth/ProtectedRoute';

// Routes: "/teams/:teamId" (admin/manager, id in the URL) AND "/ai_adoption"
// (scoped champion, id sourced from auth so the URL stays id-less). One
// component serves both. Wave-13 redesign (13B).

// Terminal statuses = "closed". A task in one of these is done.
const TERMINAL: TaskStatus[] = ['finished_successfully', 'finished_with_issues', 'abandoned', 'wont_fix'];

// System "constant" domains every champion has, matched by name suffix
// (case-insensitive) — stored per-team as "{Team}'s General" / "{Team}'s Context Creation".
// They're real rows in data.domains and SHOULD render in the fold; only the
// Domains tile's big number excludes them so it reflects real domains.
function isConstantDomain(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.endsWith('general') || n.endsWith('context creation');
}

// One stable color per domain (left accent). General catch-all renders muted.
const DOMAIN_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#6366f1', '#ef4444'];
function domainColor(name: string, idx: number): string {
  return name.trim().toLowerCase().endsWith('general') ? '#9ca3af' : DOMAIN_COLORS[idx % DOMAIN_COLORS.length]!;
}

// Tint the .task-domain-chip with the domain's stable color. General's gray
// keeps the chip reading as muted, exactly like its accent elsewhere.
function domainChipStyle(color: string): React.CSSProperties {
  return { color, borderColor: color, background: `${color}14` };
}

export default function TeamPage() {
  const { teamId: paramId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  // The team id is sourced from the URL param on /teams/:teamId, but from auth
  // on the id-less /ai_adoption route (no :teamId param). A scoped champion is a
  // non-admin, non-read_all user bound to exactly one team.
  const scopedTeamId = user && isScopedChampion(user) ? user.teams[0]! : null;
  const fromAuth = paramId === undefined;
  const effectiveTeamId = fromAuth ? scopedTeamId : Number(paramId);

  const [data, setData] = useState<TeamPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Set when the backend rejects the load with a 403 — this team is not in the
  // user's scope. We render the curated Forbidden surface, not a load error.
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(() => {
    if (effectiveTeamId == null || Number.isNaN(effectiveTeamId)) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setForbidden(false);
    api.views
      .teamPage(effectiveTeamId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        // Out-of-scope team id → the backend 403s: show the Forbidden surface.
        if (e instanceof ForbiddenError) setForbidden(true);
        else setError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveTeamId]);

  useEffect(() => load(), [load]);

  // Fold refs — tiles deep-link by opening + scrolling + flashing the fold.
  const domainsRef = useRef<HTMLDetailsElement>(null);
  const openTasksRef = useRef<HTMLDetailsElement>(null);
  const closedTasksRef = useRef<HTMLDetailsElement>(null);
  const artifactsRef = useRef<HTMLDetailsElement>(null);
  const reportsRef = useRef<HTMLDetailsElement>(null);

  // Clicking an artifact navigates to its editable detail page (/artifacts/:id),
  // mirroring how a task opens TaskDetailPage.
  function goToArtifact(artifactId: number) {
    navigate(`/artifacts/${artifactId}`);
  }

  // Guard rail: /ai_adoption reached without a resolvable single scoped team
  // (an admin/manager typed it, or a scoped user without exactly one team) →
  // fall back to the index gracefully instead of crashing.
  if (fromAuth && scopedTeamId == null) return <Navigate to="/" replace />;

  // A champion who hits their OWN team via the id-bearing /teams/:ownId collapses
  // to the clean id-less URL so the id never shows. A different team id falls
  // through to the normal load (→ backend 403 → the Forbidden surface below).
  if (!fromAuth && scopedTeamId != null && Number(paramId) === scopedTeamId) {
    return <Navigate to="/ai_adoption" replace />;
  }

  if (loading) {
    return (
      <>
        <div className="top-bar">
          {!fromAuth && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link to="/" className="btn btn-secondary btn-sm">← Teams</Link>
            </div>
          )}
        </div>
        <div className="page-body team-page">
          <div className="panel detail-hero">
            <div className="panel-body-padded">
              <div className="detail-hero-top">
                <div className="detail-hero-ident">
                  <span className="skeleton detail-hero-avatar-skel" />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton skeleton-text w-40" style={{ marginBottom: 12 }} />
                    <div className="skeleton detail-skel-title" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="tile-grid">
            {[0, 1, 2, 3, 4].map((i) => (
              <div className="skeleton" key={i} style={{ height: 92, borderRadius: 'var(--r-lg)' }} />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <div className="skeleton" key={i} style={{ height: 52, borderRadius: 12, marginBottom: 14 }} />
          ))}
        </div>
      </>
    );
  }

  // Out-of-scope team id — the backend said "not your team". Curated 403 surface.
  if (forbidden) return <Navigate to="/403" replace />;

  if (error || !data) {
    return (
      <>
        <div className="top-bar">
          {!fromAuth && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link to="/" className="btn btn-secondary btn-sm">← Teams</Link>
            </div>
          )}
        </div>
        <div className="page-body">
          <div className="panel">
            <ErrorState
              title="Couldn't load this team"
              hint="The team portfolio failed to load. Try again."
              onRetry={load}
            />
          </div>
        </div>
      </>
    );
  }

  const { team, domains, reports } = data;

  // Resolve domain_id → domain name client-side (tasks).
  const domainNameById = new Map(domains.map((dp) => [dp.domain.id, dp.domain.name]));
  // Same stable per-domain color the domain cards use (indexed by fold order).
  const domainColorById = new Map(domains.map((dp, i) => [dp.domain.id, domainColor(dp.domain.name, i)]));

  // ── Derived breakdowns for tile sub-callouts (computed client-side) ─────
  const allTasks = domains.flatMap((d) => d.tasks);
  // Open = not in a terminal status; Closed = terminal status.
  const openTaskList = allTasks.filter((t) => !TERMINAL.includes(t.status));
  const closedTaskList = allTasks.filter((t) => TERMINAL.includes(t.status));
  const blockedTasks = allTasks.filter((t) => t.status === 'blocked').length;
  const activeOpenTasks = Math.max(0, data.open_tasks - blockedTasks);
  const finishedTasks = allTasks.filter(
    (t) => t.status === 'finished_successfully' || t.status === 'finished_with_issues',
  ).length;
  const abandonedTasks = allTasks.filter(
    (t) => t.status === 'abandoned' || t.status === 'wont_fix',
  ).length;

  // Domains tile: big number = real domains only; sub-line = how many of the
  // system constants ("General", "Context creation") are actually present.
  const constantDomainCount = domains.filter((dp) => isConstantDomain(dp.domain.name)).length;
  const realDomainCount = domains.length - constantDomainCount;

  // Every artifact now lives under a domain — flatten the per-domain blocks.
  const allArtifacts = domains.flatMap((d) => d.artifacts);
  const artifactTypes = Array.from(new Set(allArtifacts.map((a) => a.type)));

  const lastMeeting = reports.length
    ? reports.map((r) => r.meeting_date).sort().slice(-1)[0]
    : null;

  // Only the LATEST report per team is editable (greatest meeting_date, tie-break
  // greatest id). Older reports are view-only; their edit affordance is removed.
  const latestReportId = reports.length
    ? [...reports].sort((a, b) =>
        a.meeting_date !== b.meeting_date
          ? a.meeting_date.localeCompare(b.meeting_date)
          : a.id - b.id,
      ).slice(-1)[0]!.id
    : null;

  function jumpTo(ref: React.RefObject<HTMLDetailsElement>) {
    const el = ref.current;
    if (!el) return;
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the flash animation
    el.classList.add('flash');
  }

  return (
    <>
      {/* Slim top bar — holds only a back affordance (omitted on the id-less
          /ai_adoption scoped-champion variant, which has nowhere to go back to).
          The team identity + primary action live in the body hero below, unified
          with the Task/Artifact/Domain detail-page family. */}
      <div className="top-bar">
        {!fromAuth && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link to="/" className="btn btn-secondary btn-sm">← Teams</Link>
          </div>
        )}
      </div>

      <div className="page-body team-page stagger-children">
        {/* ── Identity hero (avatar + name + champion meta + primary action) ── */}
        <div className="panel detail-hero">
          <div className="panel-body-padded">
            <div className="detail-hero-top">
              <div className="detail-hero-ident">
                <span className="detail-hero-avatar detail-hero-avatar--icon" aria-hidden="true">
                  <span className="detail-hero-avatar-inner">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </span>
                </span>
                <div>
                  <div className="detail-eyebrow">Team</div>
                  <h2 className="detail-title">{team.name}</h2>
                  <div className="detail-hero-meta">
                    Champion <strong>{team.champion_name}</strong>
                    {team.champion_start_date && (
                      <> &bull; since <span className="detail-hero-since">{team.champion_start_date}</span></>
                    )}
                  </div>
                </div>
              </div>
              {isAdmin && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate(`/reports/new?team=${team.id}`)}
                >
                  + Create report
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Tile dashboard ──────────────────────────────────────────── */}
        <div className="tile-grid">
          <button type="button" className="tile acc-blue" onClick={() => jumpTo(openTasksRef)}>
            <div className="tile-top">
              <span className="tile-label">Open tasks</span>
              <span className="tile-ico">▣</span>
            </div>
            <div className="tile-value"><CountUp value={data.open_tasks} /></div>
            <div className="tile-sub">
              {blockedTasks > 0 && <><span className="bad">{blockedTasks} blocked</span> &bull; </>}
              {activeOpenTasks} active
            </div>
          </button>

          <button type="button" className="tile acc-green" onClick={() => jumpTo(closedTasksRef)}>
            <div className="tile-top">
              <span className="tile-label">Closed tasks</span>
              <span className="tile-ico">✓</span>
            </div>
            <div className="tile-value"><CountUp value={data.closed_tasks} /></div>
            <div className="tile-sub">
              <span className="pos">{finishedTasks} finished</span>
              {abandonedTasks > 0 && <> &bull; {abandonedTasks} abandoned</>}
            </div>
          </button>

          <button type="button" className="tile acc-slate" onClick={() => jumpTo(reportsRef)}>
            <div className="tile-top">
              <span className="tile-label">Meetings</span>
              <span className="tile-ico">✎</span>
            </div>
            <div className="tile-value"><CountUp value={data.meeting_count} /></div>
            <div className="tile-sub">{lastMeeting ? `last: ${lastMeeting}` : 'none yet'}</div>
          </button>

          <button type="button" className="tile acc-indigo" onClick={() => jumpTo(domainsRef)}>
            <div className="tile-top">
              <span className="tile-label">Domains</span>
              <span className="tile-ico">◆</span>
            </div>
            <div className="tile-value">
              {constantDomainCount > 0 ? (
                <>
                  <CountUp value={realDomainCount} /> + {constantDomainCount}
                  <span className="tile-unit"> constants</span>
                </>
              ) : (
                <CountUp value={realDomainCount} />
              )}
            </div>
            <div className="tile-sub">{constantDomainCount > 0 ? ' ' : '—'}</div>
          </button>

          <button type="button" className="tile acc-violet" onClick={() => jumpTo(artifactsRef)}>
            <div className="tile-top">
              <span className="tile-label">Artifacts</span>
              <span className="tile-ico">◈</span>
            </div>
            <div className="tile-value"><CountUp value={data.artifact_count} /></div>
            <div className="tile-sub">{artifactTypes.length ? artifactTypes.join(' · ') : '—'}</div>
          </button>
        </div>

        {/* ── Domains fold ────────────────────────────────────────────── */}
        <details className="fold" ref={domainsRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Domains</span>
            <span className="fold-count">{data.domain_count}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              <span className="mini-pill">{data.open_tasks} open tasks</span>
              <span className="mini-pill">{data.artifact_count} artifacts</span>
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {domains.length === 0 ? (
              <div className="empty-note">No domains yet.</div>
            ) : (
              domains.map((dp, i) => (
                <DomainCard
                  key={dp.domain.id}
                  dp={dp}
                  accent={domainColor(dp.domain.name, i)}
                  onArtifactClick={goToArtifact}
                />
              ))
            )}
          </div>
        </details>

        {/* ── Open Tasks fold (flat list across all domains) ──────────── */}
        <details className="fold" ref={openTasksRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Open Tasks</span>
            <span className="fold-count">{openTaskList.length}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              {blockedTasks > 0 && <span className="mini-pill">{blockedTasks} blocked</span>}
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {openTaskList.length === 0 ? (
              <div className="empty-note">No open tasks.</div>
            ) : (
              <TasksTable tasks={openTaskList} domainNameById={domainNameById} domainColorById={domainColorById} />
            )}
          </div>
        </details>

        {/* ── Closed Tasks fold (flat list across all domains) ────────── */}
        <details className="fold" ref={closedTasksRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Closed Tasks</span>
            <span className="fold-count">{closedTaskList.length}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              {finishedTasks > 0 && <span className="mini-pill">{finishedTasks} finished</span>}
              {abandonedTasks > 0 && <span className="mini-pill">{abandonedTasks} abandoned</span>}
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {closedTaskList.length === 0 ? (
              <div className="empty-note">No closed tasks.</div>
            ) : (
              <TasksTable tasks={closedTaskList} domainNameById={domainNameById} domainColorById={domainColorById} />
            )}
          </div>
        </details>

        {/* ── Artifacts fold (full catalog: every artifact is domain-scoped) ── */}
        <details className="fold" ref={artifactsRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Artifacts</span>
            <span className="fold-count">{allArtifacts.length}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              {artifactTypes.map((t) => (
                <span className="mini-pill" key={t}>{t}</span>
              ))}
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {allArtifacts.length === 0 ? (
              <div className="empty-note">No artifacts.</div>
            ) : (
              <ArtifactsTable artifacts={allArtifacts} onArtifactClick={goToArtifact} />
            )}
          </div>
        </details>

        {/* ── Reports fold ────────────────────────────────────────────── */}
        <details className="fold" ref={reportsRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Meetings</span>
            <span className="fold-count">{reports.length}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              {lastMeeting && <span className="mini-pill">last meeting {lastMeeting}</span>}
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {reports.length === 0 ? (
              <div className="empty-note">No reports yet for {team.champion_name}.</div>
            ) : (
              reports.map((r) => (
                <div className="report-row" key={r.id}>
                  <div>
                    <div className="report-date">{r.meeting_date}</div>
                    <div className="report-label">Champion meeting &bull; {team.champion_name}</div>
                  </div>
                  {/* Everyone in scope may open the report; only admins editing the
                      latest report get an edit affordance — others open read-only. */}
                  <Link to={`/reports/${r.id}/edit`} className="btn btn-secondary btn-sm">
                    {isAdmin && r.id === latestReportId ? 'View / Edit' : 'View'}
                  </Link>
                </div>
              ))
            )}
          </div>
        </details>
      </div>
    </>
  );
}

// ---- Domain card ----

function DomainCard({
  dp,
  accent,
  onArtifactClick,
}: {
  dp: DomainPage;
  accent: string;
  onArtifactClick: (id: number) => void;
}) {
  const { domain, tasks, artifacts } = dp;

  return (
    <div
      className="domain-card"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="domain-card-header">
        <div>
          <div className="domain-card-title">
            <Link to={`/domains/${domain.id}`}>{domain.name}</Link>
          </div>
          {domain.description && (
            <div className="domain-card-meta">{domain.description}</div>
          )}
        </div>
        <div className="d-flex gap-8 align-center">
          {domain.priority !== null && (
            <span
              className="priority-badge priority-1"
              style={{
                display: 'inline-block',
                fontSize: '10px',
                padding: '2px 7px',
                borderRadius: '4px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              Priority {domain.priority}
            </span>
          )}
          <Link to={`/domains/${domain.id}`} className="btn btn-secondary btn-sm">
            View domain
          </Link>
        </div>
      </div>

      <div className="domain-card-body">
        <div className="domain-card-cols">
          <div>
            <div className="domain-col-label">Tasks</div>
            {tasks.length === 0 ? (
              <span className="text-muted text-sm">No tasks.</span>
            ) : (
              <div>
                {tasks.map((t) => (
                  <div key={t.id} style={{ marginBottom: 4 }}>
                    <span
                      className="task-pill"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <StatusBadge status={t.status} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t.name}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="domain-col-label">Artifacts</div>
            {artifacts.length === 0 ? (
              <span className="text-muted text-sm">No artifacts.</span>
            ) : (
              <div>
                {artifacts.map((a) => (
                  <div key={a.id} style={{ marginBottom: 4 }}>
                    <span
                      className="artifact-pill"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        cursor: 'pointer',
                      }}
                      onClick={() => onArtifactClick(a.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && onArtifactClick(a.id)}
                    >
                      <ArtifactTypeBadge type={a.type} />
                      <span style={{ fontSize: 12 }}>{a.name}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Week-by-week story for this domain */}
        {(dp.task_history.length > 0 || dp.artifact_history.length > 0) && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
            <div className="domain-story-label">History — week by week</div>
            <DomainStory
              tasks={dp.tasks}
              artifacts={dp.artifacts}
              taskHistory={dp.task_history}
              artifactHistory={dp.artifact_history}
              onArtifactClick={onArtifactClick}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Artifacts table used for the full-catalog Artifacts fold ----

function ArtifactsTable({
  artifacts,
  onArtifactClick,
}: {
  artifacts: Artifact[];
  onArtifactClick: (id: number) => void;
}) {
  const columns: Column<Artifact>[] = [
    {
      key: 'name',
      header: 'Artifact',
      render: (a) => (
        <span
          style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
          onClick={(e) => { e.stopPropagation(); onArtifactClick(a.id); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onArtifactClick(a.id)}
        >
          {a.name}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (a) => <ArtifactTypeBadge type={a.type} />,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (a) => <TagList tags={a.tags} />,
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (a) => (
        <span className="text-muted text-sm">{a.summary ?? '—'}</span>
      ),
    },
  ];

  return (
    <DataTable<Artifact>
      columns={columns}
      rows={artifacts}
      rowKey={(a) => a.id}
      onRowClick={(a) => onArtifactClick(a.id)}
      empty="No artifacts."
    />
  );
}

// ---- Tasks table used for the flat Open/Closed Tasks folds ----

function TasksTable({
  tasks,
  domainNameById,
  domainColorById,
}: {
  tasks: Task[];
  domainNameById: Map<number, string>;
  domainColorById: Map<number, string>;
}) {
  const columns: Column<Task>[] = [
    {
      key: 'name',
      header: 'Task',
      render: (t) => (
        <Link to={`/tasks/${t.id}`}>
          {t.name}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: 'domain',
      header: 'Domain',
      render: (t) => (
        <span className="task-domain-chip" style={domainChipStyle(domainColorById.get(t.domain_id) ?? '#9ca3af')}>
          {domainNameById.get(t.domain_id)}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (t) => <span className="text-muted text-sm">{t.owner ?? '—'}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      render: (t) => <span className="text-muted text-sm">{t.due_date ?? '—'}</span>,
    },
  ];

  return (
    <DataTable<Task>
      columns={columns}
      rows={tasks}
      rowKey={(t) => t.id}
      empty="No tasks."
    />
  );
}

// CSS class references used in this file (defined in mvp / design-system):
// .team-card, .team-card-header, .team-name, .team-champion-line
// .domain-card, .domain-card-header, .domain-card-title, .domain-card-meta
// .domain-card-body, .domain-card-cols, .domain-col-label
// .task-pill, .artifact-pill
// .report-row, .report-date, .report-label
// .no-action-items
// .priority-badge
// .story-date-group, .story-date-heading, .story-date-label, .story-date-line
// .story-entry, .story-dot-col, .story-dot, .story-connector, .story-content
// .story-what, .story-entity-type, .story-note, .story-meta
// .dot-task, .dot-artifact, .dot-finished
// .type-task, .type-artifact

// NOTE: team-card, domain-card, domain-card-*, task-pill, artifact-pill,
// priority-badge, story-*, dot-*, type-task, type-artifact, report-row,
// report-date, report-label, no-action-items are defined in the MVP HTML
// <style> blocks. They need to be added to app.css or design-system.css by
// a separate CSS pass, OR we use inline styles (done above for the critical
// bits so the page renders correctly even without the extra CSS rules).
