import './team-page.css';
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { TeamPage, DomainPage, Artifact, ArtifactDetail } from '@/types';
import { StatusBadge, ArtifactTypeBadge, TagList } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { ArtifactDetailModal } from '@/components/ArtifactDetailModal';
import type { Column } from '@/components/DataTable';
import { DomainStory } from '@/components/DomainStory';

// Route: "/teams/:championId" — one champion's portfolio, labeled by team. Wave-3 agent 3B.

export default function TeamPage() {
  const { championId } = useParams<{ championId: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<TeamPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Artifact detail modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDetail, setModalDetail] = useState<ArtifactDetail | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    if (!championId) return;
    api.views
      .teamPage(Number(championId))
      .then(setData)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [championId]);

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
          <div className="blocker-banner">{error ?? 'No data.'}</div>
        </div>
      </>
    );
  }

  const { team, champion, domains, all_team_artifacts, reports, action_items } = data;

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

      <div className="page-body">
        {/* Champion header panel */}
        <div className="panel mb-16" style={{ marginBottom: 20 }}>
          <div className="panel-body-padded">
            <div
              className="d-flex align-center"
              style={{ flexWrap: 'wrap', gap: '24px' }}
            >
              <div className="case-meta-item">
                <div className="case-meta-label">Team</div>
                <div className="case-meta-value" style={{ fontSize: 16, fontWeight: 700 }}>
                  {team.name}
                </div>
              </div>
              <div className="case-meta-item">
                <div className="case-meta-label">Current Champion</div>
                <div className="case-meta-value">{champion.name}</div>
              </div>
              {champion.start_date && (
                <div className="case-meta-item">
                  <div className="case-meta-label">Champion Since</div>
                  <div className="case-meta-value">{champion.start_date}</div>
                </div>
              )}
              {team.cc_baseline && (
                <div className="case-meta-item">
                  <div className="case-meta-label">CC Baseline</div>
                  <div className="case-meta-value">{team.cc_baseline}</div>
                </div>
              )}
              <div className="case-meta-item">
                <div className="case-meta-label">Domains</div>
                <div className="case-meta-value">{domains.length}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Domains section */}
        <div className="index-section-title">Domains</div>

        {domains.length === 0 && (
          <div className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-body-padded text-muted text-sm">No domains yet.</div>
          </div>
        )}

        {domains.map((dp) => (
          <DomainCard key={dp.domain.id} dp={dp} onArtifactClick={openArtifactModal} />
        ))}

        <hr className="section-divider" />

        {/* All-team gutter (un-domained artifacts) */}
        {all_team_artifacts.length > 0 && (
          <>
            <div className="index-section-title">All-Team Artifacts (Team-Wide)</div>
            <div className="panel" style={{ marginBottom: 20 }}>
              <ArtifactsTable
                artifacts={all_team_artifacts}
                onArtifactClick={openArtifactModal}
              />
            </div>
          </>
        )}

        {/* Reports + Action Items */}
        <div className="col-2" style={{ gap: 24, marginTop: 8 }}>
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Reports ({champion.name})</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/reports/new')}
              >
                + Create report
              </button>
            </div>
            <div className="panel-body-padded">
              {reports.length === 0 ? (
                <div className="text-muted text-sm" style={{ fontStyle: 'italic' }}>
                  No reports yet for {champion.name}.
                </div>
              ) : (
                <div>
                  {reports.map((r) => (
                    <div className="report-row" key={r.id}>
                      <div>
                        <div className="report-date">{r.meeting_date}</div>
                        <div className="report-label">Champion meeting</div>
                      </div>
                      <Link
                        to={`/reports/${r.id}/edit`}
                        className="btn btn-secondary btn-sm"
                      >
                        View / Edit
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Action Items</span>
            </div>
            <div className="panel-body-padded">
              {action_items.length === 0 ? (
                <div className="no-action-items">
                  No open action items for {champion.name}.
                </div>
              ) : (
                <ActionItemsList items={action_items} />
              )}
            </div>
          </div>
        </div>
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

// ---- Domain card ----

function DomainCard({
  dp,
  onArtifactClick,
}: {
  dp: DomainPage;
  onArtifactClick: (id: number) => void;
}) {
  const { domain, tasks, artifacts } = dp;

  return (
    <div className="domain-card">
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
              Story — Week by Week
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

function ActionItemsList({
  items,
}: {
  items: import('@/types').ActionItem[];
}) {
  return (
    <div>
      {items.map((item) => (
        <div key={item.id} className="open-item-row">
          <div className="open-item-content">
            <div
              className={`open-item-title${item.resolved ? ' text-muted' : ''}`}
              style={item.resolved ? { textDecoration: 'line-through' } : undefined}
            >
              {item.text}
            </div>
            <div className="open-item-meta">
              {item.owner && <>Owner: {item.owner} &bull; </>}
              {item.due_date && <>Due: {item.due_date} &bull; </>}
              {item.resolved ? 'Resolved' : 'Open'}
            </div>
          </div>
        </div>
      ))}
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
