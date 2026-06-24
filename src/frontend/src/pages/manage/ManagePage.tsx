import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Team, Champion, Domain } from '@/types';
import { api } from '@/api';
import { DataTable } from '@/components/DataTable';
import type { Column } from '@/components/DataTable';
import { TeamForm } from './TeamForm';
import { ChampionForm } from './ChampionForm';
import { DomainForm } from './DomainForm';

// Route: "/manage" — Teams, Champions, Domains lists with Add/Edit.

type ActiveTab = 'teams' | 'champions' | 'domains';

type ModalState =
  | { kind: 'none' }
  | { kind: 'team'; editing: Team | null }
  | { kind: 'champion'; editing: Champion | null }
  | { kind: 'domain'; editing: Domain | null };

export default function ManagePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ActiveTab>('teams');
  const [teams, setTeams] = useState<Team[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  const loadAll = useCallback(async () => {
    const [t, c, d] = await Promise.all([
      api.teams.list(),
      api.champions.list(),
      api.domains.list(),
    ]);
    setTeams(t);
    setChampions(c);
    setDomains(d);
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

  // --- Teams table ---
  const teamColumns: Column<Team>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
    },
    {
      key: 'cc_baseline',
      header: 'CC Baseline',
      render: (row) => <span className="text-muted">{row.cc_baseline ?? '—'}</span>,
    },
    {
      key: 'baseline_date',
      header: 'Baseline Date',
      render: (row) => <span className="text-muted">{row.baseline_date ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      render: (row) => (
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
  ];

  // --- Champions table ---
  const teamById = (id: number) => teams.find((t) => t.id === id)?.name ?? String(id);

  const championColumns: Column<Champion>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
    },
    {
      key: 'start_date',
      header: 'Start',
      render: (row) => <span className="text-muted">{row.start_date ?? '—'}</span>,
    },
    {
      key: 'end_date',
      header: 'End',
      render: (row) => <span className="text-muted">{row.end_date ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      render: (row) => (
        <button
          className="btn btn-secondary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            setModal({ kind: 'champion', editing: row });
          }}
        >
          Edit
        </button>
      ),
    },
  ];

  // --- Domains table ---
  const championById = (id: number) => champions.find((c) => c.id === id)?.name ?? String(id);

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
      key: 'champion',
      header: 'Champion',
      render: (row) => <span className="text-muted">{championById(row.champion_id)}</span>,
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
              <span
                key={cd.id}
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 20,
                  background: '#ede9fe',
                  color: '#5b21b6',
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {cd.team_name}: {cd.name}
              </span>
            ))}
          </div>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      render: (row) => (
        <button
          className="btn btn-secondary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            setModal({ kind: 'domain', editing: row });
          }}
        >
          Edit
        </button>
      ),
    },
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
    { id: 'champions', label: 'Champions', count: champions.length },
    { id: 'domains', label: 'Domains', count: domains.length },
  ];

  return (
    <>
      {/* Top bar */}
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Manage</span>
          <span className="top-bar-sub">Teams, champions, domains</span>
        </div>
        <div className="top-bar-actions">
          {tab === 'teams' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setModal({ kind: 'team', editing: null })}
            >
              + Add Team
            </button>
          )}
          {tab === 'champions' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setModal({ kind: 'champion', editing: null })}
            >
              + Add Champion
            </button>
          )}
          {tab === 'domains' && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/domains/extract')}
              >
                Smart domain extract
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setModal({ kind: 'domain', editing: null })}
              >
                + Add Domain
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="tabs">
        {tabLabels.map(({ id, label, count }) => (
          <button
            key={id}
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {label}
            {count > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  background: '#f3f4f6',
                  color: '#4b5563',
                  borderRadius: 10,
                  padding: '1px 7px',
                  fontWeight: 600,
                }}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Page body */}
      <div className="page-body">
        {tab === 'teams' && (
          <div className="panel">
            <DataTable
              columns={teamColumns}
              rows={teams}
              rowKey={(r) => r.id}
              empty="No teams yet. Click + Add Team to create one."
            />
          </div>
        )}
        {tab === 'champions' &&
          (champions.length === 0 ? (
            <div className="panel">
              <div className="page-body text-muted text-sm">
                No champions yet. Click + Add Champion to create one.
              </div>
            </div>
          ) : (
            groupByTeam(champions).map((group) => (
              <TeamGroupCard
                key={group.teamId}
                name={group.teamName}
                count={group.rows.length}
                noun="champion"
              >
                <DataTable
                  columns={championColumns}
                  rows={group.rows}
                  rowKey={(r) => r.id}
                />
              </TeamGroupCard>
            ))
          ))}
        {tab === 'domains' &&
          (domains.length === 0 ? (
            <div className="panel">
              <div className="page-body text-muted text-sm">
                No domains yet. Click + Add Domain to create one.
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
          ))}
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
      {modal.kind === 'champion' && (
        <ChampionForm
          open
          editing={modal.editing}
          teams={teams}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
      {modal.kind === 'domain' && (
        <DomainForm
          open
          editing={modal.editing}
          teams={teams}
          champions={champions}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
