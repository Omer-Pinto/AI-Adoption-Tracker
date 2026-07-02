import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Team, Domain } from '@/types';
import { api } from '@/api';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { TeamForm } from './TeamForm';
import { DomainForm } from './DomainForm';
import { ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';
import './manage-page.css';

// Route: "/manage" — Teams, Domains lists with Add/Edit.

type ActiveTab = 'teams' | 'domains';

type ModalState =
  | { kind: 'none' }
  | { kind: 'team'; editing: Team | null }
  | { kind: 'domain'; editing: Domain | null };

// Translucent indigo "Team: Domain" chip (tokenized — theme-correct in both modes).
const crossPillStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 'var(--r-pill)',
  background: 'var(--accent-weak)',
  color: 'var(--accent)',
  border: '1px solid var(--accent-weak-border)',
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

export default function ManagePage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<ActiveTab>('teams');
  const [teams, setTeams] = useState<Team[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [loadError, setLoadError] = useState(false);

  const loadAll = useCallback(async () => {
    setLoadError(false);
    try {
      const [t, d] = await Promise.all([
        api.teams.list(),
        api.domains.list(),
      ]);
      setTeams(t);
      setDomains(d);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function closeModal() {
    setModal({ kind: 'none' });
  }

  function handleSaved() {
    closeModal();
    void loadAll();
  }

  async function handleDeleteDomain(d: Domain) {
    if (!confirm(`Delete domain "${d.name}"? Its items will be reassigned to General.`)) return;
    try {
      await api.domains.delete(d.id);
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  // --- Teams table ---
  const teamColumns: Column<Team>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
    },
    {
      key: 'champion_name',
      header: 'Champion',
      render: (row) => <span className="text-muted">{row.champion_name}</span>,
    },
    {
      key: 'champion_start_date',
      header: 'Start',
      render: (row) => <span className="text-muted">{row.champion_start_date ?? '—'}</span>,
    },
    // Edit affordance is admin-only.
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: '',
            width: '80px',
            render: (row: Team) => (
              <button
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setModal({ kind: 'team', editing: row });
                }}
              >
                Edit
              </button>
            ),
          },
        ]
      : []),
  ];

  // --- Domains table ---
  const teamById = (id: number) => teams.find((t) => t.id === id)?.name ?? String(id);

  // Sort by numeric priority ascending (lower number = higher priority),
  // rows with no/blank/non-numeric priority sort to the bottom.
  const sortByPriority = (rows: Domain[]) =>
    [...rows].sort((a, b) => {
      const pa = Number(a.priority);
      const pb = Number(b.priority);
      const aValid = a.priority != null && a.priority.trim() !== '' && Number.isFinite(pa);
      const bValid = b.priority != null && b.priority.trim() !== '' && Number.isFinite(pb);
      if (aValid && bValid) return pa - pb;
      if (aValid) return -1;
      if (bValid) return 1;
      return 0;
    });

  const domainColumns: Column<Domain>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '100px',
      render: (row) => <span className="text-muted">{row.priority ?? '—'}</span>,
    },
    {
      key: 'cross_domains',
      header: 'Cross-domain',
      render: (row) =>
        row.cross_domains.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {row.cross_domains.map((cd) => (
              <span key={cd.id} style={crossPillStyle}>
                {cd.team_name}: {cd.name}
              </span>
            ))}
          </div>
        ),
    },
    // Edit/Delete affordances are admin-only.
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: '',
            width: '150px',
            render: (row: Domain) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ kind: 'domain', editing: row });
                  }}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger-outline btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteDomain(row);
                  }}
                >
                  Delete
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  // Group rows by team_id, ordered by the teams list, then any leftover teams.
  function groupByTeam<Row extends { team_id: number }>(rows: Row[]) {
    const byTeam = new Map<number, Row[]>();
    for (const r of rows) {
      const list = byTeam.get(r.team_id);
      if (list) list.push(r);
      else byTeam.set(r.team_id, [r]);
    }
    const orderedIds = [
      ...teams.map((t) => t.id).filter((id) => byTeam.has(id)),
      ...[...byTeam.keys()].filter((id) => !teams.some((t) => t.id === id)),
    ];
    return orderedIds.map((id) => ({
      teamId: id,
      teamName: teamById(id),
      rows: byTeam.get(id) ?? [],
    }));
  }

  function TeamGroupCard({
    name,
    count,
    noun,
    children,
  }: {
    name: string;
    count: number;
    noun: string;
    children: ReactNode;
  }) {
    const label = `${count} ${count === 1 ? noun : `${noun}s`}`;
    return (
      <div className="mgroup-card">
        <div className="mgroup-card-header">
          <span className="mgroup-card-title">{name}</span>
          <span className="mgroup-card-meta">— {label}</span>
        </div>
        {children}
      </div>
    );
  }

  const tabLabels: { id: ActiveTab; label: string; count: number }[] = [
    { id: 'teams', label: 'Teams', count: teams.length },
    { id: 'domains', label: 'Domains', count: domains.length },
  ];

  return (
    <>
      {/* Top bar */}
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Manage</span>
          <span className="top-bar-sub">Teams, domains</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tabs">
        {tabLabels.map(({ id, label, count }) => (
          <button
            key={id}
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
            {count > 0 && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>

      {/* Page body */}
      <div className="page-body">
        {loadError && (
          <div className="panel">
            <ErrorState
              title="Couldn't load this"
              hint="Teams and domains failed to load. Try again."
              onRetry={() => void loadAll()}
            />
          </div>
        )}
        {!loadError && tab === 'teams' && (
          <>
          <div className="table-toolbar">
            <span className="table-toolbar-label">
              {teams.length} {teams.length === 1 ? 'team' : 'teams'}
            </span>
            <span className="table-toolbar-spacer" />
            {isAdmin && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setModal({ kind: 'team', editing: null })}
              >
                + Add Team
              </button>
            )}
          </div>
          <div className="panel">
            <DataTable
              columns={teamColumns}
              rows={teams}
              rowKey={(r) => r.id}
              empty="No teams yet. Click + Add Team to create one."
            />
          </div>
          </>
        )}
        {!loadError && tab === 'domains' && (
          <>
          <div className="table-toolbar">
            <span className="table-toolbar-label">
              {domains.length} {domains.length === 1 ? 'domain' : 'domains'}
            </span>
            <span className="table-toolbar-spacer" />
            {isAdmin && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/domains/extract')}
                title="Opens the guided domain-extraction flow"
              >
                + Add domains
              </button>
            )}
          </div>
          {domains.length === 0 ? (
            <div className="panel">
              <div className="page-body text-muted text-sm">
                No domains yet. Click Add domains to create one.
              </div>
            </div>
          ) : (
            groupByTeam(domains).map((group) => (
              <TeamGroupCard
                key={group.teamId}
                name={group.teamName}
                count={group.rows.length}
                noun="domain"
              >
                <DataTable
                  columns={domainColumns}
                  rows={sortByPriority(group.rows)}
                  rowKey={(r) => r.id}
                />
              </TeamGroupCard>
            ))
          )}
          </>
        )}
      </div>

      {/* Isolated edit modals — only one open at a time */}
      {modal.kind === 'team' && (
        <TeamForm
          open
          editing={modal.editing}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
      {modal.kind === 'domain' && (
        <DomainForm
          open
          editing={modal.editing}
          teams={teams}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
