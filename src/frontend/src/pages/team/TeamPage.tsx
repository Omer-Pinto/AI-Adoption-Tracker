import './team-page.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { TeamPage, DomainPage, Artifact, ArtifactDetail, ActionItem, TaskStatus } from '@/types';
import { StatusBadge, ArtifactTypeBadge, TagList } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { ArtifactDetailModal } from '@/components/ArtifactDetailModal';
import type { Column } from '@/components/DataTable';
import { DomainStory } from '@/components/DomainStory';
import { ErrorState } from '@/components/EmptyState';

// Route: "/teams/:championId" — one champion's portfolio, labeled by team. Wave-13 redesign (13B).

// Terminal statuses = "closed". An action item / task in one of these is done.
const TERMINAL: TaskStatus[] = ['finished_successfully', 'finished_with_issues', 'abandoned', 'wont_fix'];
const TODAY = new Date().toISOString().slice(0, 10);

// System "constant" domains every champion has, matched by name (case-insensitive).
// They're real rows in data.domains and SHOULD render in the fold; only the
// Domains tile's big number excludes them so it reflects real domains.
const CONSTANT_DOMAINS = ['general', 'context creation'];
function isConstantDomain(name: string): boolean {
  return CONSTANT_DOMAINS.includes(name.trim().toLowerCase());
}

// One stable color per domain (left accent). General catch-all renders muted.
const DOMAIN_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#6366f1', '#ef4444'];
function domainColor(name: string, idx: number): string {
  return name.trim().toLowerCase() === 'general' ? '#9ca3af' : DOMAIN_COLORS[idx % DOMAIN_COLORS.length]!;
}

function isClosedItem(item: ActionItem): boolean {
  return item.status ? TERMINAL.includes(item.status) : !!item.resolved;
}
function isOverdue(item: ActionItem): boolean {
  return !!item.due_date && item.due_date < TODAY && !isClosedItem(item);
}

export default function TeamPage() {
  const { championId } = useParams<{ championId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<TeamPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Artifact detail modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDetail, setModalDetail] = useState<ArtifactDetail | null>(null);
  const [modalError, setModalError] = useState(false);

  const load = useCallback(() => {
    if (!championId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.views
      .teamPage(Number(championId))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { console.error(e); if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [championId]);

  useEffect(() => load(), [load]);

  // Fold refs — tiles deep-link by opening + scrolling + flashing the fold.
  const domainsRef = useRef<HTMLDetailsElement>(null);
  const artifactsRef = useRef<HTMLDetailsElement>(null);
  const reportsRef = useRef<HTMLDetailsElement>(null);
  const actionsRef = useRef<HTMLDetailsElement>(null);

  function openArtifactModal(artifactId: number) {
    setModalError(false);
    api.views
      .artifact(artifactId)
      .then((detail) => {
        setModalDetail(detail);
        setModalOpen(true);
      })
      .catch(() => {
        setModalError(true);
      });
  }

  function closeModal() {
    setModalOpen(false);
    setModalDetail(null);
    setModalError(false);
  }

  if (loading) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">Team</span>
          </div>
        </div>
        <div className="page-body">
          <div className="text-muted text-sm">Loading…</div>
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">Team</span>
          </div>
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

  const { team, champion, domains, all_team_artifacts, reports, action_items } = data;

  // ── Derived breakdowns for tile sub-callouts (computed client-side) ─────
  const allTasks = domains.flatMap((d) => d.tasks);
  const blockedTasks = allTasks.filter((t) => t.status === 'blocked').length;
  const activeOpenTasks = Math.max(0, data.open_tasks - blockedTasks);
  const finishedTasks = allTasks.filter(
    (t) => t.status === 'finished_successfully' || t.status === 'finished_with_issues',
  ).length;
  const abandonedTasks = allTasks.filter(
    (t) => t.status === 'abandoned' || t.status === 'wont_fix',
  ).length;

  const overdueActions = action_items.filter(isOverdue).length;

  // Domains tile: big number = real domains only; sub-line = how many of the
  // system constants ("General", "Context creation") are actually present.
  const constantDomainCount = domains.filter((dp) => isConstantDomain(dp.domain.name)).length;
  const realDomainCount = domains.length - constantDomainCount;

  const allArtifacts = [...domains.flatMap((d) => d.artifacts), ...all_team_artifacts];
  const artifactTypes = Array.from(new Set(allArtifacts.map((a) => a.type)));

  const lastMeeting = reports.length
    ? reports.map((r) => r.meeting_date).sort().slice(-1)[0]
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

  const avatarLetter = (champion.name || team.name || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Team {team.name}</span>
          <span className="top-bar-sub">
            Champion portfolio &bull; {champion.name}
            {champion.start_date ? ` • since ${champion.start_date}` : ''}
          </span>
        </div>
        <div className="top-bar-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/reports/new')}
          >
            + Create report
          </button>
        </div>
      </div>

      <div className="page-body team-page">
        {/* ── Identity strip ──────────────────────────────────────────── */}
        <div className="identity">
          <div className="id-avatar">{avatarLetter}</div>
          <div>
            <div className="id-name">{team.name}</div>
            <div className="id-meta">
              Champion <b>{champion.name}</b>
              {champion.start_date && <> &bull; since <b>{champion.start_date}</b></>}
              {' '}&bull; <b>{data.domain_count}</b> domains
            </div>
          </div>
          <div className="id-spacer" />
        </div>

        {/* ── Tile dashboard ──────────────────────────────────────────── */}
        <div className="tile-grid">
          <button type="button" className="tile acc-blue" onClick={() => jumpTo(domainsRef)}>
            <div className="tile-top">
              <span className="tile-label">Open tasks</span>
              <span className="tile-ico">▣</span>
            </div>
            <div className="tile-value">{data.open_tasks}</div>
            <div className="tile-sub">
              {blockedTasks > 0 && <><span className="bad">{blockedTasks} blocked</span> &bull; </>}
              {activeOpenTasks} active
            </div>
          </button>

          <button type="button" className="tile acc-green" onClick={() => jumpTo(domainsRef)}>
            <div className="tile-top">
              <span className="tile-label">Closed tasks</span>
              <span className="tile-ico">✓</span>
            </div>
            <div className="tile-value">{data.closed_tasks}</div>
            <div className="tile-sub">
              <span className="pos">{finishedTasks} finished</span>
              {abandonedTasks > 0 && <> &bull; {abandonedTasks} abandoned</>}
            </div>
          </button>

          <button type="button" className="tile acc-amber" onClick={() => jumpTo(actionsRef)}>
            <div className="tile-top">
              <span className="tile-label">Open actions</span>
              <span className="tile-ico">☑</span>
            </div>
            <div className="tile-value">{data.open_action_items}</div>
            <div className="tile-sub">
              {overdueActions > 0 && <><span className="warn">{overdueActions} overdue</span> &bull; </>}
              {data.closed_action_items} closed
            </div>
          </button>

          <button type="button" className="tile acc-slate" onClick={() => jumpTo(reportsRef)}>
            <div className="tile-top">
              <span className="tile-label">Meetings</span>
              <span className="tile-ico">✎</span>
            </div>
            <div className="tile-value">{data.meeting_count}</div>
            <div className="tile-sub">{lastMeeting ? `last: ${lastMeeting}` : 'none yet'}</div>
          </button>

          <button type="button" className="tile acc-indigo" onClick={() => jumpTo(domainsRef)}>
            <div className="tile-top">
              <span className="tile-label">Domains</span>
              <span className="tile-ico">◆</span>
            </div>
            <div className="tile-value">
              {constantDomainCount > 0 ? `${realDomainCount} + ${constantDomainCount}` : realDomainCount}
            </div>
            <div className="tile-sub">{constantDomainCount > 0 ? 'constants' : '—'}</div>
          </button>

          <button type="button" className="tile acc-violet" onClick={() => jumpTo(artifactsRef)}>
            <div className="tile-top">
              <span className="tile-label">Artifacts</span>
              <span className="tile-ico">◈</span>
            </div>
            <div className="tile-value">{data.artifact_count}</div>
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
                  onArtifactClick={openArtifactModal}
                />
              ))
            )}
          </div>
        </details>

        {/* ── Artifacts fold (full catalog: domain-scoped + team-wide) ── */}
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
              <ArtifactsTable artifacts={allArtifacts} onArtifactClick={openArtifactModal} />
            )}
          </div>
        </details>

        {/* ── Reports fold ────────────────────────────────────────────── */}
        <details className="fold" ref={reportsRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Reports</span>
            <span className="fold-count">{reports.length}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              {lastMeeting && <span className="mini-pill">last meeting {lastMeeting}</span>}
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {reports.length === 0 ? (
              <div className="empty-note">No reports yet for {champion.name}.</div>
            ) : (
              reports.map((r) => (
                <div className="report-row" key={r.id}>
                  <div>
                    <div className="report-date">{r.meeting_date}</div>
                    <div className="report-label">Champion meeting &bull; {champion.name}</div>
                  </div>
                  <Link to={`/reports/${r.id}/edit`} className="btn btn-secondary btn-sm">
                    View / Edit
                  </Link>
                </div>
              ))
            )}
          </div>
        </details>

        {/* ── Action items fold ───────────────────────────────────────── */}
        <details className="fold" ref={actionsRef}>
          <summary>
            <span className="chev">▶</span>
            <span className="fold-title">Action items</span>
            <span className="fold-count">{action_items.length}</span>
            <span className="fold-spacer" />
            <span className="fold-pills">
              <span className="mini-pill">{data.open_action_items} open</span>
              {overdueActions > 0 && <span className="mini-pill">{overdueActions} overdue</span>}
            </span>
            <span className="fold-hint" />
          </summary>
          <div className="fold-body">
            {action_items.length === 0 ? (
              <div className="empty-note">No action items for {champion.name}.</div>
            ) : (
              <ActionItemsList items={action_items} />
            )}
          </div>
        </details>
      </div>

      {modalError && (
        <div className="warning-banner" style={{ margin: '12px 0' }}>
          Couldn&apos;t open that artifact. Please try again.
        </div>
      )}
      <ArtifactDetailModal open={modalOpen} onClose={closeModal} detail={modalDetail} />
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
                background: '#fee2e2',
                color: '#991b1b',
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
                      <span style={{ fontSize: 12, color: '#374151' }}>{t.name}</span>
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
          <div style={{ marginTop: 16, borderTop: '1px solid #f3f4f6', paddingTop: 14 }}>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                color: '#9ca3af',
                marginBottom: 10,
              }}
            >
              History — week by week
            </div>
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

// ---- Artifacts table used for all-team gutter ----

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
          style={{ color: '#4361ee', cursor: 'pointer' }}
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
      empty="No team-wide artifacts."
    />
  );
}

// ---- Action items list ----

function ActionItemsList({ items }: { items: ActionItem[] }) {
  return (
    <div>
      {items.map((item) => {
        const closed = isClosedItem(item);
        const overdue = isOverdue(item);
        return (
          <div key={item.id} className={`ai-row${closed ? ' resolved' : ''}`}>
            <div className="ai-main">
              <div className="ai-text">{item.text}</div>
              <div className="ai-meta">
                {item.owner && (
                  <span className="ai-owner">
                    <span className="dot">{item.owner.trim().charAt(0).toUpperCase()}</span>
                    {item.owner}
                  </span>
                )}
                {item.due_date && (
                  <span className={`ai-due${overdue ? ' overdue' : ''}`}>
                    Due {item.due_date}{overdue ? ' (overdue)' : ''}
                  </span>
                )}
                {item.status && <StatusBadge status={item.status} />}
              </div>
            </div>
            <Link
              to={`/reports/${item.report_id}/edit`}
              className="btn btn-secondary btn-sm"
              title="Edit the report this action item came from"
            >
              Edit report
            </Link>
          </div>
        );
      })}
    </div>
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
