import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import type { ReportJson, TeamPageIndexEntry } from '@/types';
import { EmptyState, ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';

// Route: "/reports/new"
// Champion is folded into the team — report creation is entered from a TEAM,
// not a champion.
// 1. Enter via ?team=<teamId> (the team's champion is shown as static text), OR
//    context-less (/reports/new) → a minimal team chooser picks the team.
// 2. Paste raw meeting notes.
// 3. Click "Draft with model" → api.reports.draft(teamId, notes).
// 4. On success, navigate to /reports/draft/preview carrying the ReportJson +
//    teamId in router state. The preview page reads it via useLocation().state.

// Inline look for a read-only field value (no `form-static` class in the DS).
const STATIC_VALUE = { fontSize: 13, fontWeight: 600, color: 'var(--text)' };

export default function ReportCreatePage() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [searchParams] = useSearchParams();

  // The team is the unit of entry. When ?team= is present we lock to it and show
  // the champion as static text; otherwise the page renders a team chooser.
  const enteredFromTeam = Boolean(searchParams.get('team'));

  const [teams, setTeams] = useState<TeamPageIndexEntry[]>([]);
  const [teamId, setTeamId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Team-list load state — kept apart from the draft action error so a transient
  // fetch blip degrades to a calm message, not a red banner.
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadTeams = useCallback(() => {
    setLoadingTeams(true);
    setLoadError(false);
    api.views.teamsIndex().then((list) => {
      setTeams(list);
      // Pre-select the team from ?team= query param when present and valid.
      const paramId = searchParams.get('team');
      if (paramId) {
        const parsed = Number(paramId);
        if (!Number.isNaN(parsed) && list.some((t) => t.team_id === parsed)) {
          setTeamId(parsed);
        }
      }
    }).catch((e) => {
      console.error(e);
      setLoadError(true);
    }).finally(() => {
      setLoadingTeams(false);
    });
    // searchParams is stable from useSearchParams and intentionally read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => loadTeams(), [loadTeams]);

  // Report creation is admin-only; non-admins are bounced to the shared 403 page.
  if (!isAdmin) return <Navigate to="/403" replace />;

  const selectedTeam = teams.find((t) => t.team_id === teamId) ?? null;

  async function handleDraft() {
    if (!teamId || !notes.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const draft: ReportJson = await api.reports.draft(teamId, notes.trim());
      // Hand the draft + teamId to the preview page via location state. The
      // preview route has no real :reportId yet (not saved), so we use the
      // sentinel "draft"; ReportPreviewPage reads the ReportJson + teamId from
      // location.state rather than fetching from the API.
      navigate('/reports/draft/preview', { state: { draft, teamId } });
    } catch {
      setError('Draft failed. Check that the backend is running and try again.');
    } finally {
      setDrafting(false);
    }
  }

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Create Report</span>
          {selectedTeam && (
            <span className="top-bar-sub">
              {selectedTeam.team_name} — {selectedTeam.champion_name}
            </span>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/">Teams</a>
          <span className="breadcrumb-sep">/</span>
          <span>Create Report</span>
        </div>

        {/* Step indicator */}
        <div className="step-row">
          <div className="step-item active">
            <div className="step-num">1</div>
            Paste notes
          </div>
          <div className="step-arrow" />
          <div className="step-item">
            <div className="step-num">2</div>
            Review draft
          </div>
          <div className="step-arrow" />
          <div className="step-item">
            <div className="step-num">3</div>
            Confirm &amp; save
          </div>
        </div>

        {error && (
          <div className="blocker-banner" style={{ marginBottom: 16 }}>
            <div className="blocker-banner-label">Error</div>
            {error}
          </div>
        )}

        {loadError ? (
          <div className="panel">
            <ErrorState
              title="Couldn't load teams"
              hint="The team list failed to load. Try again."
              onRetry={loadTeams}
            />
          </div>
        ) : !loadingTeams && teams.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon="◇"
              title="No teams yet"
              hint={
                <>
                  Add a team in <Link to="/manage">Manage</Link> before creating a report.
                </>
              }
            />
          </div>
        ) : (
        <div className="form-shell">
          {/* Team / champion */}
          <div className="form-section">
            <div className="form-section-title">Meeting info</div>

            {enteredFromTeam && selectedTeam ? (
              // Entered from a team — champion is the team's champion (static).
              <>
                <div className="form-row">
                  <label className="form-label">Team</label>
                  <span style={STATIC_VALUE}>{selectedTeam.team_name}</span>
                </div>
                <div className="form-row">
                  <label className="form-label">Champion</label>
                  <span style={STATIC_VALUE}>{selectedTeam.champion_name}</span>
                </div>
              </>
            ) : (
              // Context-less — minimal team chooser. Picking a team shows its champion.
              <>
                <div className="form-row">
                  <label className="form-label form-label-required">Team</label>
                  <select
                    className="form-select"
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">— select team —</option>
                    {teams.map((t) => (
                      <option key={t.team_id} value={t.team_id}>
                        {t.team_name} — {t.champion_name}
                      </option>
                    ))}
                  </select>
                </div>
                {selectedTeam && (
                  <div className="form-row">
                    <label className="form-label">Champion</label>
                    <span style={STATIC_VALUE}>{selectedTeam.champion_name}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Raw notes */}
          <div className="form-section">
            <div className="form-section-title">Raw meeting notes</div>

            <div className="form-row" style={{ marginBottom: 8 }}>
              <label className="form-label form-label-required">Paste your raw notes</label>
              <textarea
                className="notes-area"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  'Paste everything here — rough, unstructured, copied from your notes app or a doc.\n\n' +
                  'The model will read these and produce a structured report: it will identify which tasks changed status, ' +
                  'any new tasks or artifacts, action items, and anything worth flagging. You do not need to fill any fields yourself.\n\n' +
                  'Example:\n' +
                  'talked with Dana — clutter map is still going, she ran a first pilot this week\n' +
                  'we retired the CFAR tuning work, not worth it\n' +
                  'started a new thing: doppler check, just planned for now\n' +
                  'she created a new skill called clutter-review to speed up the review step\n' +
                  'action: I (Omer) need to find a context-usage tool\n' +
                  'action: Dana to talk to QA about access'
                }
              />
            </div>

            <div className="model-callout">
              <strong>How this works:</strong> when you click &ldquo;Draft report with model&rdquo;, your notes are sent
              to the backend. The model maps what you wrote onto the structured report fields — task statuses, artifact
              changes, action items, discussion notes, and issues — using the existing domain and task records as context.
              You then review the draft before anything is saved.
            </div>
          </div>

          {/* Actions */}
          <div className="form-actions">
            <button
              className="draft-btn"
              disabled={!teamId || !notes.trim() || drafting}
              onClick={() => void handleDraft()}
            >
              {drafting ? '...' : '▶'} Draft report with model
            </button>
            <span className="text-muted text-sm">
              Your notes are not saved until you confirm the draft.
            </span>
          </div>
        </div>
        )}
      </div>
    </>
  );
}
