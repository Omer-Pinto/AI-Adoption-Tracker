import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type { ReportJson, TeamEntities } from '@/types';
import { ErrorState } from '@/components/EmptyState';
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!reportId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.reports
      .get(Number(reportId))
      .then(async ({ report: saved }) => {
        const parsed = JSON.parse(saved.report_json) as ReportJson;
        if (cancelled) return;
        setReport(parsed);
        setKeys(makeKeys(parsed));

        // Derive team_id from the report's champion → team entities + domains.
        const champs = await api.champions.list();
        if (cancelled) return;
        const champ = champs.find((c) => c.id === saved.champion_id);
        const [ents, doms] = await Promise.all([
          champ ? api.views.teamEntities(champ.team_id) : Promise.resolve(EMPTY_ENTITIES),
          api.domains.listByChampion(saved.champion_id),
        ]);
        if (cancelled) return;
        setEntities(ents);
        setDomains(doms.map((d) => ({ id: d.id, name: d.name })));
      })
      .catch((e) => { console.error(e); setError('Failed to load report.'); })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  useEffect(() => load(), [load]);

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
      navigate(`/teams/${saved.champion_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">Edit Report</span>
          </div>
        </div>
        <div className="page-body">
          <div className="text-muted">Loading…</div>
        </div>
      </>
    );
  }

  if (error && !report) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">Edit Report</span>
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
          <span className="top-bar-title">Edit Report</span>
          <span className="top-bar-sub">
            {report.champion}
            {report.meeting_date ? ` — ${report.meeting_date}` : ''}
          </span>
        </div>
        <div className="top-bar-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="breadcrumb">
          <a href="/">Teams</a>
          <span className="breadcrumb-sep">/</span>
          <span>Edit Report — {report.meeting_date}</span>
        </div>

        <div className="info-banner" style={{ marginBottom: 20 }}>
          <strong>Editing a saved report.</strong> You are editing the structured fields, not the original raw
          notes. On save, task and artifact records will be recomputed from this report&apos;s data.
        </div>

        {error && (
          <div className="blocker-banner" style={{ marginBottom: 16 }}>
            <div className="blocker-banner-label">Error</div>
            {error}
          </div>
        )}

        <FlatReportEditor
          report={report}
          keys={keys}
          entities={entities}
          domains={domains}
          onReportChange={setReport}
          onKeysChange={setKeys}
        />

        <div className="form-actions-bottom" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
