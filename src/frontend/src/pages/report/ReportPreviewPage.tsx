import { useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type {
  ReportArtifactLine,
  ReportDomainBlock,
  ReportJson,
  ReportTaskLine,
  TaskStatus,
  ArtifactType,
  ArtifactChangeKind,
} from '@/types';
import { ArtifactTypeBadge, ChangeKindBadge, StatusBadge } from '@/components/Badge';
import { makeArtifactLine, makeTaskLine } from './reportUtils';

// Monotonic counter for stable block/item keys.
let _keyCounter = 0;
function nextKey(): string {
  return String(++_keyCounter);
}

// Route: "/reports/:reportId/preview"
// reportId === "draft"  →  draft carried in router state (not yet saved)
// The preview page reads location.state.draft = ReportJson.

interface PreviewLocationState {
  draft?: ReportJson;
}

const TASK_STATUSES: TaskStatus[] = [
  'planned',
  'in-progress',
  'finished_successfully',
  'finished_with_issues',
  'blocked',
  'abandoned',
];

const CHANGE_KINDS: ArtifactChangeKind[] = ['added', 'updated', 'retired', 'moved'];
const ARTIFACT_TYPES: ArtifactType[] = ['agent', 'skill', 'hook', 'context'];

// ---- Inline-editable task row ----

function EditableTaskLine({
  line,
  onChange,
}: {
  line: ReportTaskLine;
  onChange: (updated: ReportTaskLine) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Local mutable state for the inline form; uses plain strings, converted on save.
  const [taskName, setTaskName] = useState(line.task);
  const [status, setStatus] = useState<TaskStatus>(line.status);
  const [owner, setOwner] = useState(line.owner ?? '');
  const [note, setNote] = useState(line.note ?? '');

  function openEdit() {
    setTaskName(line.task);
    setStatus(line.status);
    setOwner(line.owner ?? '');
    setNote(line.note ?? '');
    setEditing(true);
  }

  function save() {
    onChange(makeTaskLine(taskName, status, owner, note, line.finished_on));
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="preview-task-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="preview-task-name">{line.task}</div>
          {line.note && <div className="preview-task-note">&ldquo;{line.note}&rdquo;</div>}
          {line.owner && (
            <div className="preview-task-note" style={{ fontStyle: 'normal' }}>
              owner: {line.owner}
            </div>
          )}
        </div>
        <StatusBadge status={line.status} />
        <button
          className="btn btn-sm btn-outline"
          style={{ marginLeft: 8, flexShrink: 0 }}
          onClick={openEdit}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="task-edit-block" style={{ margin: '8px 20px' }}>
      <div className="form-grid-2" style={{ marginBottom: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Task name</label>
          <input
            type="text"
            className="form-input"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Status</label>
          <select
            className="form-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-grid-2" style={{ marginBottom: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Owner</label>
          <input
            type="text"
            className="form-input"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="optional"
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Note</label>
          <input
            type="text"
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ---- Inline-editable artifact row ----

function EditableArtifactLine({
  line,
  onChange,
}: {
  line: ReportArtifactLine;
  onChange: (updated: ReportArtifactLine) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [artifactName, setArtifactName] = useState(line.artifact);
  const [type, setType] = useState(line.type ?? '');
  const [changeKind, setChangeKind] = useState(line.change_kind ?? '');
  const [tagsRaw, setTagsRaw] = useState((line.tags ?? []).join(', '));
  const [note, setNote] = useState(line.note ?? '');

  function openEdit() {
    setArtifactName(line.artifact);
    setType(line.type ?? '');
    setChangeKind(line.change_kind ?? '');
    setTagsRaw((line.tags ?? []).join(', '));
    setNote(line.note ?? '');
    setEditing(true);
  }

  function save() {
    onChange(makeArtifactLine(artifactName, type, changeKind, tagsRaw, note));
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="preview-artifact-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="preview-task-name">{line.artifact}</div>
          {line.note && <div className="preview-task-note">&ldquo;{line.note}&rdquo;</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {line.type && <ArtifactTypeBadge type={line.type} />}
            {(line.tags ?? []).map((t) => (
              <span key={t} className="tag-chip" style={{ fontSize: 11 }}>{t}</span>
            ))}
          </div>
        </div>
        {line.change_kind && <ChangeKindBadge kind={line.change_kind} />}
        <button
          className="btn btn-sm btn-outline"
          style={{ marginLeft: 8, flexShrink: 0 }}
          onClick={openEdit}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="artifact-edit-block" style={{ margin: '8px 20px' }}>
      <div className="form-grid-2" style={{ marginBottom: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Artifact name</label>
          <input
            type="text"
            className="form-input"
            value={artifactName}
            onChange={(e) => setArtifactName(e.target.value)}
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">— type —</option>
            {ARTIFACT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-grid-2" style={{ marginBottom: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Change kind</label>
          <select
            className="form-select"
            value={changeKind}
            onChange={(e) => setChangeKind(e.target.value)}
          >
            <option value="">— kind —</option>
            {CHANGE_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Tags (comma-separated)</label>
          <input
            type="text"
            className="form-input"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
          />
        </div>
      </div>
      <div className="form-row" style={{ marginBottom: 10 }}>
        <label className="form-label">Note</label>
        <input
          type="text"
          className="form-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="optional"
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ---- Domain section ----

function DomainSection({
  block,
  taskKeys,
  artifactKeys,
  onChange,
}: {
  block: ReportDomainBlock;
  taskKeys: string[];
  artifactKeys: string[];
  onChange: (updated: ReportDomainBlock) => void;
}) {
  function updateTask(idx: number, updated: ReportTaskLine) {
    const tasks = [...(block.tasks ?? [])];
    tasks[idx] = updated;
    onChange({ ...block, tasks });
  }

  function updateArtifact(idx: number, updated: ReportArtifactLine) {
    const artifacts = [...(block.artifacts ?? [])];
    artifacts[idx] = updated;
    onChange({ ...block, artifacts });
  }

  const hasTasks = (block.tasks ?? []).length > 0;
  const hasArtifacts = (block.artifacts ?? []).length > 0;

  return (
    <div className="domain-section">
      <div className="domain-section-header">
        <div className="domain-section-name">{block.domain}</div>
      </div>
      <div>
        {hasTasks && (
          <>
            <div className="subsection-label">Task changes</div>
            {(block.tasks ?? []).map((t, i) => (
              <EditableTaskLine
                key={taskKeys[i]}
                line={t}
                onChange={(updated) => updateTask(i, updated)}
              />
            ))}
          </>
        )}
        {hasArtifacts && (
          <>
            <div
              className="subsection-label"
              style={hasTasks ? { borderTop: '1px solid #f3f4f6' } : undefined}
            >
              Artifact changes
            </div>
            {(block.artifacts ?? []).map((a, i) => (
              <EditableArtifactLine
                key={artifactKeys[i]}
                line={a}
                onChange={(updated) => updateArtifact(i, updated)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Main page ----

export default function ReportPreviewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const locationState = location.state as PreviewLocationState | null;
  const initialDraft = locationState?.draft ?? null;

  const [report, setReport] = useState<ReportJson | null>(initialDraft);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable keys for domain task/artifact rows; initialised once from the draft.
  const [domainTaskKeys] = useState<string[][]>(() =>
    (initialDraft?.domains ?? []).map((d) => (d.tasks ?? []).map(() => nextKey())),
  );
  const [domainArtifactKeys] = useState<string[][]>(() =>
    (initialDraft?.domains ?? []).map((d) => (d.artifacts ?? []).map(() => nextKey())),
  );
  const domainTaskKeysRef = useRef(domainTaskKeys);
  const domainArtifactKeysRef = useRef(domainArtifactKeys);

  const isDraftMode = reportId === 'draft';

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
            No draft found. Please go back to{' '}
            <a href="/reports/new">Create Report</a> and draft again.
          </div>
        </div>
      </>
    );
  }

  function updateDomain(idx: number, updated: ReportDomainBlock) {
    setReport((prev) => {
      if (!prev) return prev;
      const domains = [...(prev.domains ?? [])];
      domains[idx] = updated;
      return { ...prev, domains };
    });
  }

  async function handleConfirm() {
    if (!report) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await api.reports.create(report);
      navigate(`/teams/${result.report.champion_id}`);
    } catch {
      setError('Failed to save report. Please try again.');
    } finally {
      setConfirming(false);
    }
  }

  function handleDiscard() {
    navigate('/reports/new');
  }

  const actionButtons = (
    <>
      <button className="btn btn-danger-outline btn-sm" onClick={handleDiscard}>
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
  );

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
        {/* Breadcrumb */}
        <div className="breadcrumb">
          <a href="/">Teams</a>
          <span className="breadcrumb-sep">/</span>
          <a href="/reports/new">Create Report</a>
          <span className="breadcrumb-sep">/</span>
          <span>Preview</span>
        </div>

        {/* Step indicator */}
        <div className="step-row">
          <div className="step-item done">
            <div className="step-num">&#10003;</div>
            Paste notes
          </div>
          <div className="step-arrow" />
          <div className="step-item active">
            <div className="step-num">2</div>
            Review draft
          </div>
          <div className="step-arrow" />
          <div className="step-item">
            <div className="step-num">3</div>
            Confirm &amp; save
          </div>
        </div>

        {/* Not-saved banner */}
        {isDraftMode && (
          <div className="preview-banner">
            <div>
              <div className="preview-banner-text">Not saved yet &mdash; preview only</div>
              <div className="preview-banner-sub">
                This is what the model drafted from your notes. Review each section, use the inline
                Edit buttons to correct anything, then confirm to save.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
              {actionButtons}
            </div>
          </div>
        )}

        {error && (
          <div className="blocker-banner" style={{ marginBottom: 16 }}>
            <div className="blocker-banner-label">Error</div>
            {error}
          </div>
        )}

        {/* Meeting info card */}
        <div className="report-card">
          <div className="report-card-header">
            <div className="report-card-title">Meeting info</div>
          </div>
          <div className="report-card-body">
            <div className="meta-row">
              <div className="meta-item">
                <span className="meta-label">Champion</span>
                <span className="meta-value">{report.champion}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Meeting date</span>
                <span className="meta-value">{report.meeting_date || '—'}</span>
              </div>
              {(report.participants ?? []).length > 0 && (
                <div className="meta-item">
                  <span className="meta-label">Participants</span>
                  <span className="meta-value">{(report.participants ?? []).join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Domain blocks */}
        {(report.domains ?? []).map((block, i) => (
          <DomainSection
            key={block.domain}
            block={block}
            taskKeys={domainTaskKeysRef.current[i] ?? []}
            artifactKeys={domainArtifactKeysRef.current[i] ?? []}
            onChange={(updated) => updateDomain(i, updated)}
          />
        ))}

        {/* Action items */}
        {(report.action_items ?? []).length > 0 && (
          <div className="report-card">
            <div className="report-card-header">
              <div className="report-card-title">Action items</div>
            </div>
            <div style={{ padding: 0 }}>
              {(report.action_items ?? []).map((item, i) => (
                <div key={i} className="action-item-row">
                  <div className="action-item-text">{item.text}</div>
                  {item.owner && <span className="action-item-owner">{item.owner}</span>}
                  {item.due_date && (
                    <span className="text-xs text-muted">{item.due_date}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Discussion */}
        {report.discussion && (
          <div className="report-card">
            <div className="report-card-header">
              <div className="report-card-title">Discussion</div>
            </div>
            <div className="free-text-block">{report.discussion}</div>
          </div>
        )}

        {/* Issues */}
        {report.issues && (
          <div className="report-card">
            <div className="report-card-header">
              <div className="report-card-title">Issues flagged</div>
            </div>
            <div className="free-text-block">{report.issues}</div>
          </div>
        )}

        {/* Confirm bar (bottom) */}
        <div className="confirm-bar">
          <div className="confirm-bar-label">
            Looks good? Confirming will write this report to the database and update all task and
            artifact records.
          </div>
          <button className="btn btn-danger-outline" onClick={handleDiscard}>
            Discard
          </button>
          <button
            className="btn btn-success"
            disabled={confirming}
            onClick={() => void handleConfirm()}
          >
            {confirming ? 'Saving...' : 'Confirm & save'}
          </button>
        </div>
      </div>
    </>
  );
}
