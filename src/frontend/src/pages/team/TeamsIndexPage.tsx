import './team-page.css';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { TeamPageIndexEntry } from '@/types';
import { EmptyState, ErrorState } from '@/components/EmptyState';
import { CountUp } from '@/components/CountUp';
import { useAuth } from '@/auth/AuthContext';

// Route: "/" — Teams index (list of champion portfolios). Wave-3 agent 3B.

export default function TeamsIndexPage() {
  const { isAdmin } = useAuth();
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
      </div>

      <div className="page-body">
        {loading && (
          <div className="teams-grid">
            {[0, 1, 2, 3].map((i) => (
              <div className="team-card team-card--skeleton" key={i} aria-hidden="true">
                <div className="team-card-top">
                  <div className="skeleton" style={{ width: 46, height: 46, borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton skeleton-text w-60" />
                    <div className="skeleton skeleton-text w-40" />
                  </div>
                </div>
                <div className="skeleton skeleton-text w-40" style={{ marginTop: 4 }} />
                <div className="skeleton" style={{ height: 32, borderRadius: 'var(--r-md)', marginTop: 6 }} />
              </div>
            ))}
          </div>
        )}

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
                isAdmin ? (
                  <>
                    Add your first team and champion in <Link to="/manage">Manage</Link> to
                    start tracking adoption.
                  </>
                ) : (
                  'No teams are available to you yet.'
                )
              }
            />
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <PortfolioSummary entries={entries} />
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="teams-grid stagger-children">
            {entries.map((entry) => (
              <TeamCard key={entry.team_id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// Compact portfolio strip. Honest aggregates derived ONLY from the already-loaded
// teams rows — no extra API call. "Champions" is intentionally omitted: it's 1:1
// with teams, so a separate champion count would just restate the team count.
function PortfolioSummary({ entries }: { entries: TeamPageIndexEntry[] }) {
  const teamCount = entries.length;
  const totalDomains = entries.reduce((sum, e) => sum + e.domain_count, 0);

  return (
    <div className="portfolio-summary anim-enter" role="group" aria-label="Portfolio summary">
      <div className="pf-stat">
        <span className="pf-eyebrow">Portfolio</span>
        <span className="pf-num tabular"><CountUp value={teamCount} /></span>
        <span className="pf-lbl">{teamCount === 1 ? 'Team' : 'Teams'}</span>
      </div>
      <span className="pf-div" aria-hidden="true" />
      <div className="pf-stat">
        <span className="pf-eyebrow">Tracked</span>
        <span className="pf-num tabular"><CountUp value={totalDomains} /></span>
        <span className="pf-lbl">{totalDomains === 1 ? 'Domain' : 'Domains'}</span>
      </div>
    </div>
  );
}

// One card per team (exactly one champion per team in the 1:1 model).
function TeamCard({ entry }: { entry: TeamPageIndexEntry }) {
  const { isAdmin } = useAuth();
  const initial = (entry.champion_name || entry.team_name || '?').trim().charAt(0).toUpperCase();
  const domainLabel = entry.domain_count === 1 ? 'domain' : 'domains';

  return (
    <div className="team-card hover-lift">
      <span className="team-card-glow" aria-hidden="true" />

      <div className="team-card-top">
        <span className="team-avatar" aria-hidden="true">
          <span className="team-avatar-inner">{initial}</span>
        </span>
        <div className="team-card-heading">
          <Link to={`/teams/${entry.team_id}`} className="team-name">
            {entry.team_name}
          </Link>
          <div className="team-champion-line">
            Champion <strong>{entry.champion_name}</strong>
          </div>
        </div>
      </div>

      <div className="team-card-stats">
        <span className="team-stat-chip" title={`${entry.domain_count} ${domainLabel}`}>
          <span className="team-stat-num tabular">{entry.domain_count}</span>
          <span className="team-stat-lbl">{domainLabel}</span>
        </span>
        {entry.domain_count === 0 && (
          <span className="team-stat-hint">No domains yet</span>
        )}
      </div>

      <div className="team-card-actions">
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
  );
}
