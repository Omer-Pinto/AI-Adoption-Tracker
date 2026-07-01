import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, ForbiddenError } from '@/api';
import type { ReportJson, TeamEntities } from '@/types';
import { ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';
import {
  FlatReportEditor,
  findMissingArtifactTypes,
  makeKeys,
  stripReportForSave,
  type DomainOption,
  type EditorKeys,
} from './reportEditor';

// Route: "/reports/:reportId/edit"
// Loads a saved report, binds the FLAT structured editor (not the raw notes),
// saves via PATCH (which replays the report → recomputes task/artifact records).

const EMPTY_ENTITIES: TeamEntities = { tasks: [], artifacts: [] };

export default function ReportEditPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [report, setReport] = useState<ReportJson | null>(null);
  const [keys, setKeys] = useState<EditorKeys>({
    tasks: [],
    artifacts: [],
    actionItems: [],
    discussion: [],
    issues: [],
  });
  const [entities, setEntities] = useState<TeamEntities>(EMPTY_ENTITIES);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  // Only the LATEST report per team is editable. Older reports load read-only
  // (Save hidden, inputs disabled) but stay viewable.
  const [isLatest, setIsLatest] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the backend rejects the load with a 403 — the report is not in this
  // user's team scope. We render the curated Forbidden surface, not a load error.
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(() => {
    if (!reportId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    api.reports
      .get(Number(reportId))
      .then(async ({ report: saved }) => {
        const parsed = JSON.parse(saved.report_json) as ReportJson;
        if (cancelled) return;
        setTeamId(saved.team_id);
        setKeys(makeKeys(parsed));

        // Team-keyed: team entities + team domains + the team page (for the
        // report list, to know if THIS report is the latest), plus the LIVE
        // champion name.
        const [ents, doms, teams, teamPage] = await Promise.all([
          api.views.teamEntities(saved.team_id),
          api.domains.listByTeam(saved.team_id),
          api.teams.list(),
          api.views.teamPage(saved.team_id),
        ]);
        if (cancelled) return;
        const team = teams.find((t) => t.id === saved.team_id);
        setReport(team ? { ...parsed, champion: team.champion_name } : parsed);
        setEntities(ents);
        setDomains(doms.map((d) => ({ id: d.id, name: d.name })));
        // Latest = greatest meeting_date, tie-break greatest id.
        const latest = [...teamPage.reports].sort((a, b) =>
          a.meeting_date !== b.meeting_date
            ? a.meeting_date.localeCompare(b.meeting_date)
            : a.id - b.id,
        ).slice(-1)[0];
        setIsLatest(latest ? latest.id === saved.id : true);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        // Out-of-scope report id → the backend 403s: show the Forbidden surface.
        if (e instanceof ForbiddenError) setForbidden(true);
        else setError('Failed to load report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  useEffect(() => load(), [load]);

  // Non-admins may VIEW a report that is in their team scope (the backend already
  // gate-keeps: an out-of-scope id 404/403s during load → ForbiddenError). They
  // get a fully read-only rendering; only admins editing the LATEST report edit.
  const canEdit = isAdmin && isLatest;
  const readOnly = !canEdit;

  async function handleSave() {
    if (!report || !reportId) return;
    const missing = findMissingArtifactTypes(report);
    if (missing.length > 0) {
      setError(
        `Cannot save: the following NEW artifact(s) have no type selected — please set one first: ${missing.join(', ')}`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = stripReportForSave(report);
      const { report: saved } = await api.reports.update(Number(reportId), payload);
      navigate(`/teams/${saved.team_id}`);
    } catch (err) {
      // 409 = the backend rejected the edit because this is no longer the latest
      // report for its team. Flip to read-only and explain.
      if (err instanceof ApiError && err.status === 409) {
        setIsLatest(false);
        setError('This report can no longer be edited — a newer report exists for this team.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save report. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">{canEdit ? 'Edit Report' : 'View Report'}</span>
          </div>
        </div>
        <div className="page-body">
          <div className="text-muted">Loading…</div>
        </div>
      </>
    );
  }

  // Out-of-scope report id — the backend said "not your team". Curated 403 surface.
  if (forbidden) return <Navigate to="/403" replace />;

  if (error && !report) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">{canEdit ? 'Edit Report' : 'View Report'}</span>
          </div>
        </div>
        <div className="page-body">
          <div className="panel">
            <ErrorState
              title="Couldn't load this report"
              hint="The report failed to load. Try again."
              onRetry={load}
            />
          </div>
        </div>
      </>
    );
  }

  if (!report) return null;

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">{canEdit ? 'Edit Report' : 'View Report'}</span>
          <span className="top-bar-sub">
            {report.champion}
            {report.meeting_date ? ` — ${report.meeting_date}` : ''}
            {readOnly ? ' • read-only' : ''}
          </span>
        </div>
        <div className="top-bar-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => (teamId != null ? navigate(`/teams/${teamId}`) : navigate(-1))}
          >
            {canEdit ? 'Cancel' : 'Back'}
          </button>
          {canEdit && (
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="breadcrumb">
          <a href="/">Teams</a>
          <span className="breadcrumb-sep">/</span>
          <span>{canEdit ? 'Edit' : 'View'} Report — {report.meeting_date}</span>
        </div>

        {canEdit ? (
          <div className="info-banner" style={{ marginBottom: 20 }}>
            <strong>Editing a saved report.</strong> You are editing the structured fields, not the original raw
            notes. On save, task and artifact records will be recomputed from this report&apos;s data.
          </div>
        ) : !isAdmin ? (
          <div className="info-banner" style={{ marginBottom: 20 }}>
            <strong>Read-only view.</strong> You have view access to this report. Editing is limited to admins.
          </div>
        ) : (
          <div className="warning-banner" style={{ marginBottom: 20 }}>
            <strong>Read-only.</strong> Only the latest report for this team can be edited. This is an older
            report — you can view it, but editing is disabled.
          </div>
        )}

        {error && (
          <div className="blocker-banner" style={{ marginBottom: 16 }}>
            <div className="blocker-banner-label">Error</div>
            {error}
          </div>
        )}

        <fieldset className="ro-editor" disabled={readOnly}>
          <FlatReportEditor
            report={report}
            keys={keys}
            entities={entities}
            domains={domains}
            showActionItems={false}
            readOnly={readOnly}
            onReportChange={setReport}
            onKeysChange={setKeys}
          />
        </fieldset>

        {canEdit && (
          <div className="form-actions-bottom" style={{ marginTop: 18 }}>
            <button className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => (teamId != null ? navigate(`/teams/${teamId}`) : navigate(-1))}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </>
  );
}
