import './domain-page.css';
import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/api';
import type { DomainPage as DomainPageData, Artifact, Task, ArtifactDetail } from '@/types';
import { StatusBadge, ArtifactTypeBadge, TagList } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { ArtifactDetailModal } from '@/components/ArtifactDetailModal';
import type { Column } from '@/components/DataTable';
import { DomainStory } from '@/components/DomainStory';
import { ErrorState } from '@/components/EmptyState';

// Route: "/domains/:domainId" — single domain: current tasks/artifacts + story. Wave-3 agent 3B.

export default function DomainPage() {
  const { domainId } = useParams<{ domainId: string }>();

  const [data, setData] = useState<DomainPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Artifact detail modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDetail, setModalDetail] = useState<ArtifactDetail | null>(null);
  const [modalError, setModalError] = useState(false);

  const load = useCallback(() => {
    if (!domainId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.views
      .domainPage(Number(domainId))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { console.error(e); if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domainId]);

  useEffect(() => load(), [load]);

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
            <span className="top-bar-title">Domain</span>
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
            <span className="top-bar-title">Domain</span>
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
      <div className="top-bar">
        <div>
          <span className="top-bar-title">{domain.name}</span>
          <span className="top-bar-sub">Current state + week-by-week history</span>
        </div>
        <div className="top-bar-actions">
          <Link
            to={`/teams/${domain.champion_id}`}
            className="btn btn-secondary btn-sm"
          >
            &#8592; Team page
          </Link>
        </div>
      </div>

      <div className="page-body">
        {/* Breadcrumb */}
        <div className="breadcrumb" style={{ marginBottom: 16 }}>
          <Link to="/">Teams</Link>
          <span className="breadcrumb-sep">/</span>
          <Link to={`/teams/${domain.champion_id}`}>Team</Link>
          <span className="breadcrumb-sep">/</span>
          <span>{domain.name}</span>
        </div>

        {/* Domain header */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-body-padded">
            <div
              style={{ fontSize: 22, fontWeight: 800, color: '#1a1d23', marginBottom: 6 }}
            >
              {domain.name}
            </div>
            {domain.description && (
              <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
                {domain.description}
              </div>
            )}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
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
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                      {domain.cross_domains.map((cd) => (
                        <Link
                          key={cd.id}
                          to={`/domains/${cd.id}`}
                          style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 20,
                            background: '#ede9fe',
                            color: '#5b21b6',
                            fontSize: 12,
                            fontWeight: 600,
                            textDecoration: 'none',
                          }}
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
          <ArtifactsTable artifacts={artifacts} onArtifactClick={openArtifactModal} />
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
          onArtifactClick={openArtifactModal}
          connectors
        />
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

