import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import type { Champion, ReportJson } from '@/types';

// Route: "/reports/new"
// 1. Select champion from the full list.
// 2. Paste raw meeting notes.
// 3. Click "Draft with model" → api.reports.draft(notes, championId).
// 4. On success, navigate to /reports/preview carrying the ReportJson in router state.
//    The preview page reads it via useLocation().state.draft — no shared store needed.

export default function ReportCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [champions, setChampions] = useState<Champion[]>([]);
  const [championId, setChampionId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.champions.list().then((list) => {
      setChampions(list);
      // Pre-select champion from ?champion= query param when present and valid.
      const paramId = searchParams.get('champion');
      if (paramId) {
        const parsed = Number(paramId);
        if (!Number.isNaN(parsed) && list.some((c) => c.id === parsed)) {
          setChampionId(parsed);
        }
      }
    }).catch(() => {
      setError('Failed to load champions.');
    });
    // searchParams is stable from useSearchParams and intentionally read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedChampion = champions.find((c) => c.id === championId) ?? null;

  async function handleDraft() {
    if (!championId || !notes.trim()) return;
    setDrafting(true);
    setError(null);
    try {
      const draft: ReportJson = await api.reports.draft(notes.trim(), championId);
      // Hand the draft to the preview page via location state.
      // The preview page is a transient route — no :reportId yet (not saved).
      // We use the literal path "preview" (workaround: no real id).
      // The router has /reports/:reportId/preview; we use the sentinel "new".
      // Navigate to the preview route. Since the report isn't saved yet there
      // is no real reportId; we use the sentinel "draft". ReportPreviewPage
      // checks useParams().reportId === 'draft' and reads the ReportJson from
      // location.state.draft rather than fetching from the API.
      navigate('/reports/draft/preview', { state: { draft, championId } });
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
          {selectedChampion && (
            <span className="top-bar-sub">{selectedChampion.name}</span>
          )}
        </div>
        <div className="top-bar-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            Cancel
          </button>
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

        <div className="form-shell">
          {/* Champion selector */}
          <div className="form-section">
            <div className="form-section-title">Meeting info</div>

            <div className="form-row">
              <label className="form-label form-label-required">Champion</label>
              <select
                className="form-select"
                value={championId}
                onChange={(e) => setChampionId(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">— select champion —</option>
                {champions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
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
              disabled={!championId || !notes.trim() || drafting}
              onClick={() => void handleDraft()}
            >
              {drafting ? '...' : '▶'} Draft report with model
            </button>
            <span className="text-muted text-sm">
              Your notes are not saved until you confirm the draft.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
