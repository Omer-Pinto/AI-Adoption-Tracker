import './domain-page.css';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { api, ForbiddenError } from '@/api';
import type { DomainPage as DomainPageData, Artifact, Task } from '@/types';
import { StatusBadge, ArtifactTypeBadge, TagList } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { DomainStory } from '@/components/DomainStory';
import { ErrorState } from '@/components/EmptyState';

// Route: "/domains/:domainId" — single domain: current tasks/artifacts + story. Wave-3 agent 3B.

export default function DomainPage() {
  const { domainId } = useParams<{ domainId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<DomainPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Set when the backend rejects the load with a 403 — this domain is not in the
  // user's scope. We render the curated Forbidden surface, not a load error.
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(() => {
    if (!domainId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setForbidden(false);
    api.views
      .domainPage(Number(domainId))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        // Out-of-scope domain id → the backend 403s: show the Forbidden surface.
        if (e instanceof ForbiddenError) setForbidden(true);
        else setError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domainId]);

  useEffect(() => load(), [load]);

  // Clicking an artifact navigates to its editable detail page (/artifacts/:id),
  // mirroring how a task opens TaskDetailPage.
  function goToArtifact(artifactId: number) {
    navigate(`/artifacts/${artifactId}`);
  }

  if (loading) {
    return (
      <>
        <div className="top-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
              ← Back
            </button>
          </div>
        </div>
        <div className="page-body">
          <div className="panel detail-hero" style={{ marginBottom: 20 }}>
            <div className="panel-body-padded">
              <div className="detail-hero-top">
                <div className="detail-hero-ident">
                  <span className="skeleton detail-hero-avatar-skel" />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton skeleton-text w-40" style={{ marginBottom: 12 }} />
                    <div className="skeleton domain-skel-title" />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="panel">
            <div className="data-table-skeleton">
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
              <div className="skeleton skeleton-row" />
            </div>
          </div>
        </div>
      </>
    );
  }

  // Out-of-scope domain id — the backend said "not your team". Curated 403 surface.
  if (forbidden) return <Navigate to="/403" replace />;

  if (error || !data) {
    return (
      <>
        <div className="top-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
              ← Back
            </button>
          </div>
        </div>
        <div className="page-body">
          <div className="panel">
            <ErrorState
              title="Couldn't load this domain"
              hint="The domain failed to load. Try again."
              onRetry={load}
            />
          </div>
        </div>
      </>
    );
  }

  const { domain, tasks, artifacts, task_history, artifact_history } = data;

  return (
    <>
      {/* Slim top bar — a single back affordance to the parent team page,
          replacing the old body breadcrumb (matches Task/Artifact which carry
          no breadcrumb). Identity + meta live in the body hero below. */}
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link
            to={`/teams/${domain.team_id}`}
            className="btn btn-secondary btn-sm"
          >
            &#8592; Team page
          </Link>
        </div>
      </div>

      <div className="page-body stagger-children">
        {/* Domain identity hero — shared .detail-hero (icon avatar + eyebrow +
            title), with description + meta below, unified with Task/Artifact. */}
        <div className="panel detail-hero" style={{ marginBottom: 20 }}>
          <div className="panel-body-padded">
            <div className="detail-hero-top">
              <div className="detail-hero-ident">
                <span className="detail-hero-avatar detail-hero-avatar--icon" aria-hidden="true">
                  <span className="detail-hero-avatar-inner">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </span>
                </span>
                <div>
                  <div className="detail-eyebrow">Domain</div>
                  <h2 className="detail-title">{domain.name}</h2>
                </div>
              </div>
            </div>
            {domain.description && (
              <p className="domain-hero-desc">{domain.description}</p>
            )}
            <div className="domain-hero-meta">
              {domain.priority !== null && (
                <div className="case-meta-item">
                  <div className="case-meta-label">Priority</div>
                  <div className="case-meta-value">{domain.priority}</div>
                </div>
              )}
              <div className="case-meta-item">
                <div className="case-meta-label">Cross-domain</div>
                <div className="case-meta-value">
                  {domain.cross_domains.length === 0 ? (
                    <span className="text-muted">none</span>
                  ) : (
                    <div className="domain-cross-links">
                      {domain.cross_domains.map((cd) => (
                        <Link
                          key={cd.id}
                          to={`/domains/${cd.id}`}
                          className="domain-cross-chip"
                        >
                          {cd.team_name}: {cd.name}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Current state section */}
        <div className="index-section-title">Current State</div>

        {/* Tasks table */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span className="panel-title">Tasks</span>
          </div>
          <TasksTable tasks={tasks} />
        </div>

        {/* Artifacts table */}
        <div className="panel" style={{ marginBottom: 28 }}>
          <div className="panel-header">
            <span className="panel-title">Artifacts</span>
          </div>
          <ArtifactsTable artifacts={artifacts} onArtifactClick={goToArtifact} />
        </div>

        {/* History — week by week (data-driven from report history; not narration) */}
        <div className="index-section-title" style={{ marginBottom: 20 }}>
          History — week by week
        </div>

        <DomainStory
          tasks={tasks}
          artifacts={artifacts}
          taskHistory={task_history}
          artifactHistory={artifact_history}
          onArtifactClick={goToArtifact}
          connectors
        />
      </div>
    </>
  );
}

// ---- Tasks table ----

function TasksTable({ tasks }: { tasks: Task[] }) {
  const columns: Column<Task>[] = [
    {
      key: 'name',
      header: 'Task',
      render: (t) => <span>{t.name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge status={t.status} />,
      width: '160px',
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (t) => <span>{t.owner ?? '—'}</span>,
      width: '120px',
    },
    {
      key: 'started_on',
      header: 'Started',
      render: (t) => <span>{t.started_on ?? '—'}</span>,
      width: '110px',
    },
    {
      key: 'due_date',
      header: 'Due',
      render: (t) => <span>{t.due_date ?? '—'}</span>,
      width: '110px',
    },
  ];

  return (
    <DataTable<Task>
      columns={columns}
      rows={tasks}
      rowKey={(t) => t.id}
      empty="No tasks for this domain."
    />
  );
}

// ---- Artifacts table ----

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
          className="cell-link"
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
      width: '100px',
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
      empty="No artifacts for this domain."
    />
  );
}

