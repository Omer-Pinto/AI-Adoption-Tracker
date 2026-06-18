import './domain-page.css';
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/api';
import type { DomainPage as DomainPageData, Artifact, Task, ArtifactDetail } from '@/types';
import { StatusBadge, ArtifactTypeBadge, TagList } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { ArtifactDetailModal } from '@/components/ArtifactDetailModal';
import type { Column } from '@/components/DataTable';
import { DomainStory } from '@/components/DomainStory';

// Route: "/domains/:domainId" — single domain: current tasks/artifacts + story. Wave-3 agent 3B.

export default function DomainPage() {
  const { domainId } = useParams<{ domainId: string }>();

  const [data, setData] = useState<DomainPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Artifact detail modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDetail, setModalDetail] = useState<ArtifactDetail | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!domainId) return;
    api.views
      .domainPage(Number(domainId))
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [domainId]);

  function openArtifactModal(artifactId: number) {
    setModalError(null);
    api.views
      .artifact(artifactId)
      .then((detail) => {
        setModalDetail(detail);
        setModalOpen(true);
      })
      .catch((e: unknown) => {
        setModalError(String(e));
      });
  }

  function closeModal() {
    setModalOpen(false);
    setModalDetail(null);
    setModalError(null);
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
          <div className="blocker-banner">{error ?? 'No data.'}</div>
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
          <span className="top-bar-sub">Current state + week-by-week story</span>
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
              {domain.scope && (
                <div className="case-meta-item">
                  <div className="case-meta-label">Scope</div>
                  <div className="case-meta-value">{domain.scope}</div>
                </div>
              )}
              {domain.cross_domain && (
                <div className="case-meta-item">
                  <div className="case-meta-label">Cross-domain</div>
                  <div className="case-meta-value">{domain.cross_domain}</div>
                </div>
              )}
              {!domain.cross_domain && (
                <div className="case-meta-item">
                  <div className="case-meta-label">Cross-domain</div>
                  <div className="case-meta-value text-muted">none</div>
                </div>
              )}
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

        {/* Story — Week by Week */}
        <div className="index-section-title" style={{ marginBottom: 6 }}>
          Story — Week by Week
        </div>

        <div className="info-banner" style={{ marginBottom: 20 }}>
          The story is the heart of this product. Each entry records what changed at a
          meeting. Read top to bottom to follow the full arc of this domain.
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
        <div className="blocker-banner" style={{ margin: '12px 0' }}>
          Failed to load artifact: {modalError}
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
      key: 'ended_on',
      header: 'Ended',
      render: (t) => <span>{t.ended_on ?? '—'}</span>,
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

