import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
      key: 'team',
      header: 'Team',
      render: (row) => <span className="text-muted">{teamById(row.team_id)}</span>,
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

  const domainColumns: Column<Domain>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span style={{ fontWeight: 600 }}>{row.name}</span>,
    },
    {
      key: 'team',
      header: 'Team',
      render: (row) => <span className="text-muted">{row.team_name || teamById(row.team_id)}</span>,
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
              <Link to="/domains/setup" className="btn btn-secondary btn-sm">
                Set up domains
              </Link>
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
        <div className="panel">
          {tab === 'teams' && (
            <DataTable
              columns={teamColumns}
              rows={teams}
              rowKey={(r) => r.id}
              empty="No teams yet. Click + Add Team to create one."
            />
          )}
          {tab === 'champions' && (
            <DataTable
              columns={championColumns}
              rows={champions}
              rowKey={(r) => r.id}
              empty="No champions yet. Click + Add Champion to create one."
            />
          )}
          {tab === 'domains' && (
            <DataTable
              columns={domainColumns}
              rows={domains}
              rowKey={(r) => r.id}
              empty="No domains yet. Click + Add Domain to create one."
            />
          )}
        </div>
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
