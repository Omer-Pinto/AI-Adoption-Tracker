import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type { ReportJson, TeamEntities } from '@/types';
import {
  FlatReportEditor,
  findMissingArtifactTypes,
  makeKeys,
  stripReportForSave,
  type DomainOption,
  type EditorKeys,
} from './reportEditor';

// Route: "/reports/:reportId/preview"
// reportId === "draft"  →  draft carried in router state (not yet saved).
// The model just drafted this from raw notes; the user reviews/corrects inline,
// then Confirm & save fans it out to the tables. Nothing is persisted until then.

interface PreviewLocationState {
  draft?: ReportJson;
  /** champion_id forwarded from ReportCreatePage; used to derive team + domains. */
  championId?: number;
}

const EMPTY_ENTITIES: TeamEntities = { tasks: [], artifacts: [] };

export default function ReportPreviewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const locationState = location.state as PreviewLocationState | null;
  const initialDraft = locationState?.draft ?? null;
  const championId = locationState?.championId ?? null;

  const [report, setReport] = useState<ReportJson | null>(initialDraft);
  const [keys, setKeys] = useState<EditorKeys>(() =>
    initialDraft
      ? makeKeys(initialDraft)
      : { tasks: [], artifacts: [], actionItems: [], discussion: [], issues: [] },
  );
  const [entities, setEntities] = useState<TeamEntities>(EMPTY_ENTITIES);
  const [domains, setDomains] = useState<DomainOption[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDraftMode = reportId === 'draft';

  // Derive team_id from champion → fetch team entities (picker) + champion domains.
  useEffect(() => {
    if (!championId) return;
    let cancelled = false;
    api.champions
      .list()
      .then((champs) => {
        const champ = champs.find((c) => c.id === championId);
        if (!champ) return undefined;
        return Promise.all([
          api.views.teamEntities(champ.team_id),
          api.domains.listByChampion(championId),
        ]).then(([ents, doms]) => {
          if (cancelled) return;
          setEntities(ents);
          setDomains(doms.map((d) => ({ id: d.id, name: d.name })));
        });
      })
      .catch(() => {
        // Non-fatal: pickers degrade to empty; editing still works.
      });
    return () => {
      cancelled = true;
    };
  }, [championId]);

  async function handleConfirm() {
    if (!report) return;
    const missing = findMissingArtifactTypes(report);
    if (missing.length > 0) {
      setError(
        `Cannot save: the following NEW artifact(s) have no type selected — please set one first: ${missing.join(', ')}`,
      );
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const payload = stripReportForSave(report);
      const result = await api.reports.create(payload);
      navigate(`/teams/${result.report.champion_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report. Please try again.');
    } finally {
      setConfirming(false);
    }
  }

  const actionButtons = useMemo(
    () => (
      <>
        <button className="btn btn-danger-outline btn-sm" onClick={() => navigate('/reports/new')}>
          Discard
        </button>
        <button
          className="btn btn-success btn-sm"
          disabled={confirming}
          onClick={() => void handleConfirm()}
        >
          {confirming ? 'Saving...' : 'Confirm & save'}
        </button>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirming, report],
  );

  if (!report) {
    return (
      <>
        <div className="top-bar">
          <div>
            <span className="top-bar-title">Preview Report</span>
          </div>
        </div>
        <div className="page-body">
          <div className="warning-banner">
            No draft found. Please go back to <a href="/reports/new">Create Report</a> and draft again.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Report Preview</span>
          <span className="top-bar-sub">
            {report.champion}
            {report.meeting_date ? ` — ${report.meeting_date}` : ''}
          </span>
        </div>
        <div className="top-bar-actions">{actionButtons}</div>
      </div>

      <div className="page-body">
        <div className="breadcrumb">
          <a href="/">Teams</a>
          <span className="breadcrumb-sep">/</span>
          <a href="/reports/new">Create Report</a>
          <span className="breadcrumb-sep">/</span>
          <span>Preview</span>
        </div>

        {isDraftMode && (
          <div className="preview-banner">
            <div>
              <div className="preview-banner-text">Not saved yet — preview only</div>
              <div className="preview-banner-sub">
                This is what the model drafted from your notes. Review each section, correct anything inline,
                then confirm to save.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>{actionButtons}</div>
          </div>
        )}

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

        <div className="confirm-bar">
          <div className="confirm-bar-label">
            Looks good? Confirming will write this report to the database and update all task and artifact
            records.
          </div>
          <button className="btn btn-danger-outline" onClick={() => navigate('/reports/new')}>
            Discard
          </button>
          <button className="btn btn-success" disabled={confirming} onClick={() => void handleConfirm()}>
            {confirming ? 'Saving...' : 'Confirm & save'}
          </button>
        </div>
      </div>
    </>
  );
}
