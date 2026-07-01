import './team-page.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { TeamPageIndexEntry } from '@/types';
import { EmptyState, ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';

// Route: "/" — Teams index (list of champion portfolios). Wave-3 agent 3B.

export default function TeamsIndexPage() {
  const [entries, setEntries] = useState<TeamPageIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    api.views
      .teamsIndex()
      .then(setEntries)
      .catch((e) => { console.error(e); setError(true); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Teams</span>
          <span className="top-bar-sub">All team champion portfolios</span>
        </div>
        <div className="top-bar-actions">
          <Link to="/manage" className="btn btn-secondary btn-sm">
            Manage teams / domains
          </Link>
        </div>
      </div>

      <div className="page-body">
        {loading && <div className="text-muted text-sm">Loading teams…</div>}

        {!loading && error && (
          <div className="panel">
            <ErrorState
              title="Couldn't load teams"
              hint="The teams list failed to load. Try again."
              onRetry={load}
            />
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="panel">
            <EmptyState
              icon="◇"
              title="No teams yet"
              hint={
                <>
                  Add your first team and champion in <Link to="/manage">Manage</Link> to
                  start tracking adoption.
                </>
              }
            />
          </div>
        )}

        {!loading && !error &&
          entries.map((entry) => (
            <TeamCard key={entry.team_id} entry={entry} />
          ))}
      </div>
    </>
  );
}

// One card per team (exactly one champion per team in the 1:1 model).
function TeamCard({ entry }: { entry: TeamPageIndexEntry }) {
  const { isAdmin } = useAuth();
  return (
    <div className="team-card">
      <div className="team-card-header">
        <div className="team-name">{entry.team_name}</div>
      </div>
      <div className="team-card-body">
        <div className="team-champion-row">
          <div className="team-champion-row-main">
            <div className="team-champion-line">
              Champion: <strong>{entry.champion_name}</strong>
            </div>
            <div
              style={{
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                color: '#9ca3af',
                marginTop: '6px',
                marginBottom: '4px',
              }}
            >
              Domains ({entry.domain_count})
            </div>
            {entry.domain_count === 0 && (
              <div className="text-muted text-sm" style={{ padding: '2px 0' }}>
                No domains yet.
              </div>
            )}
          </div>
          <div className="d-flex gap-8 align-center">
            {isAdmin && (
              <Link
                to={`/reports/new?team=${entry.team_id}`}
                className="btn btn-primary btn-sm"
              >
                + Create report
              </Link>
            )}
            <Link to={`/teams/${entry.team_id}`} className="btn btn-secondary btn-sm">
              View team
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
