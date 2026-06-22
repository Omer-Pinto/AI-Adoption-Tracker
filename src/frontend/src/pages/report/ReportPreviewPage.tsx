import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type {
  ReportActionItemLine,
  ReportArtifactLine,
  ReportDomainBlock,
  ReportJson,
  ReportTaskLine,
  TaskStatus,
  ArtifactType,
  ArtifactChangeKind,
} from '@/types';
import { ArtifactTypeBadge, ChangeKindBadge, StatusBadge } from '@/components/Badge';
import { makeActionItemLine, makeArtifactLine, makeTaskLine, setOptionalString } from './reportUtils';

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
  /** champion_id forwarded from ReportCreatePage so we can fetch domain names. */
  championId?: number;
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

// ---- Domain picker (inline select) ----

function DomainPicker({
  currentDomain,
  availableDomains,
  onChange,
}: {
  currentDomain: string;
  availableDomains: string[];
  onChange: (newDomain: string) => void;
}) {
  if (availableDomains.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <label style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>Domain:</label>
      <select
        className="form-select"
        style={{ fontSize: 12, padding: '2px 6px', height: 26, minWidth: 100 }}
        value={currentDomain}
        onChange={(e) => onChange(e.target.value)}
      >
        {availableDomains.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
    </div>
  );
}

// ---- Inline-editable task row ----

function EditableTaskLine({
  line,
  availableDomains,
  currentDomain,
  onChange,
  onMoveToDomain,
}: {
  line: ReportTaskLine;
  availableDomains: string[];
  currentDomain: string;
  onChange: (updated: ReportTaskLine) => void;
  onMoveToDomain: (targetDomain: string) => void;
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
        <DomainPicker
          currentDomain={currentDomain}
          availableDomains={availableDomains}
          onChange={onMoveToDomain}
        />
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
  availableDomains,
  currentDomain,
  onChange,
  onMoveToDomain,
}: {
  line: ReportArtifactLine;
  availableDomains: string[];
  currentDomain: string;
  onChange: (updated: ReportArtifactLine) => void;
  onMoveToDomain: (targetDomain: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [artifactName, setArtifactName] = useState(line.artifact);
  const [type, setType] = useState(line.type ?? '');
  const [changeKind, setChangeKind] = useState(line.change_kind ?? '');
  const [tagsRaw, setTagsRaw] = useState((line.tags ?? []).join(', '));
  const [note, setNote] = useState(line.note ?? '');
  // Inline validation: type is required for new artifacts (no existing type on the line)
  const [typeError, setTypeError] = useState<string | null>(null);

  function openEdit() {
    setArtifactName(line.artifact);
    setType(line.type ?? '');
    setChangeKind(line.change_kind ?? '');
    setTagsRaw((line.tags ?? []).join(', '));
    setNote(line.note ?? '');
    setTypeError(null);
    setEditing(true);
  }

  function save() {
    if (!type) {
      setTypeError('Type is required before saving this artifact.');
      return;
    }
    setTypeError(null);
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
            {!line.type && (
              <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
                No type — edit required
              </span>
            )}
            {(line.tags ?? []).map((t) => (
              <span key={t} className="tag-chip" style={{ fontSize: 11 }}>{t}</span>
            ))}
          </div>
        </div>
        {line.change_kind && <ChangeKindBadge kind={line.change_kind} />}
        <DomainPicker
          currentDomain={currentDomain}
          availableDomains={availableDomains}
          onChange={onMoveToDomain}
        />
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
          <label className="form-label form-label-required">Type</label>
          <select
            className="form-select"
            value={type}
            onChange={(e) => { setType(e.target.value); if (e.target.value) setTypeError(null); }}
            style={typeError ? { borderColor: '#dc2626' } : undefined}
          >
            <option value="">— type —</option>
            {ARTIFACT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {typeError && (
            <span style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{typeError}</span>
          )}
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

// ---- Inline-editable action item row ----

function EditableActionItemLine({
  item,
  onChange,
  onRemove,
}: {
  item: ReportActionItemLine;
  onChange: (updated: ReportActionItemLine) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [owner, setOwner] = useState(item.owner ?? '');
  const [dueDate, setDueDate] = useState(item.due_date ?? '');

  function openEdit() {
    setText(item.text);
    setOwner(item.owner ?? '');
    setDueDate(item.due_date ?? '');
    setEditing(true);
  }

  function save() {
    onChange(makeActionItemLine(text, owner, dueDate, item.domain));
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="action-item-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="action-item-text">{item.text}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            {item.owner && <span className="action-item-owner">{item.owner}</span>}
            {item.due_date && (
              <span className="text-xs text-muted">{item.due_date}</span>
            )}
            {item.domain && (
              <span className="text-xs text-muted">domain: {item.domain}</span>
            )}
          </div>
        </div>
        <button
          className="btn btn-sm btn-outline"
          style={{ flexShrink: 0 }}
          onClick={openEdit}
        >
          Edit
        </button>
        <button
          className="btn btn-sm btn-danger-outline"
          style={{ flexShrink: 0 }}
          onClick={onRemove}
        >
          &times;
        </button>
      </div>
    );
  }

  return (
    <div className="action-edit-row" style={{ margin: '8px 0' }}>
      <div style={{ flex: 1 }}>
        <label className="form-label">Action</label>
        <input
          type="text"
          className="form-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Action text…"
        />
      </div>
      <div style={{ width: 140 }}>
        <label className="form-label">Owner</label>
        <input
          type="text"
          className="form-input"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="optional"
        />
      </div>
      <div style={{ width: 130 }}>
        <label className="form-label">Due date</label>
        <input
          type="date"
          className="form-input"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
      <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 6, paddingBottom: 0 }}>
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
  availableDomains,
  onChange,
  onMoveTask,
  onMoveArtifact,
}: {
  block: ReportDomainBlock;
  taskKeys: string[];
  artifactKeys: string[];
  availableDomains: string[];
  onChange: (updated: ReportDomainBlock) => void;
  onMoveTask: (taskIdx: number, targetDomain: string) => void;
  onMoveArtifact: (artifactIdx: number, targetDomain: string) => void;
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
        <div className="domain-section-name">Domain: {block.domain}</div>
      </div>
      <div>
        {hasTasks && (
          <>
            <div className="subsection-label">Task changes</div>
            {(block.tasks ?? []).map((t, i) => (
              <EditableTaskLine
                key={taskKeys[i]}
                line={t}
                availableDomains={availableDomains}
                currentDomain={block.domain}
                onChange={(updated) => updateTask(i, updated)}
                onMoveToDomain={(targetDomain) => onMoveTask(i, targetDomain)}
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
                availableDomains={availableDomains}
                currentDomain={block.domain}
                onChange={(updated) => updateArtifact(i, updated)}
                onMoveToDomain={(targetDomain) => onMoveArtifact(i, targetDomain)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ---- Validation: check for artifacts missing a type ----

function findMissingTypes(report: ReportJson): string[] {
  const missing: string[] = [];
  for (const domain of report.domains ?? []) {
    for (const a of domain.artifacts ?? []) {
      if (!a.type) missing.push(a.artifact || '(unnamed artifact)');
    }
  }
  for (const a of report.artifacts ?? []) {
    if (!a.type) missing.push(a.artifact || '(unnamed artifact)');
  }
  return missing;
}

// ---- Move helpers: pure functions that produce updated ReportJson ----

/**
 * Move a task at `taskIdx` inside domain `domainIdx` to `targetDomain`.
 * Creates the target domain block if it doesn't exist.
 */
function moveTask(
  report: ReportJson,
  domainIdx: number,
  taskIdx: number,
  targetDomain: string,
): ReportJson {
  const domains = (report.domains ?? []).map((d) => ({ ...d, tasks: [...(d.tasks ?? [])], artifacts: [...(d.artifacts ?? [])] }));
  const sourceDomain = domains[domainIdx];
  if (!sourceDomain) return report;
  const task = sourceDomain.tasks[taskIdx];
  if (!task) return report;
  // Remove from source
  sourceDomain.tasks.splice(taskIdx, 1);
  // Find or create target domain block
  const targetIdx = domains.findIndex((d) => d.domain === targetDomain);
  const targetBlock = targetIdx >= 0 ? domains[targetIdx] : null;
  if (targetBlock) {
    targetBlock.tasks.push(task);
  } else {
    domains.push({ domain: targetDomain, tasks: [task], artifacts: [] });
  }
  return { ...report, domains };
}

/**
 * Move an artifact at `artifactIdx` inside domain `domainIdx` to `targetDomain`.
 * Creates the target domain block if it doesn't exist.
 */
function moveArtifactInDomain(
  report: ReportJson,
  domainIdx: number,
  artifactIdx: number,
  targetDomain: string,
): ReportJson {
  const domains = (report.domains ?? []).map((d) => ({ ...d, tasks: [...(d.tasks ?? [])], artifacts: [...(d.artifacts ?? [])] }));
  const sourceDomain = domains[domainIdx];
  if (!sourceDomain) return report;
  const artifact = sourceDomain.artifacts[artifactIdx];
  if (!artifact) return report;
  // Remove from source
  sourceDomain.artifacts.splice(artifactIdx, 1);
  // Find or create target domain block
  const targetIdx = domains.findIndex((d) => d.domain === targetDomain);
  const targetBlock = targetIdx >= 0 ? domains[targetIdx] : null;
  if (targetBlock) {
    targetBlock.artifacts.push(artifact);
  } else {
    domains.push({ domain: targetDomain, tasks: [], artifacts: [artifact] });
  }
  return { ...report, domains };
}

/**
 * Move a top-level (team-wide) artifact at `artifactIdx` to a domain block.
 * Removes it from `report.artifacts` and adds it to the target domain block.
 * If targetDomain is the sentinel "Team-wide" it stays in report.artifacts.
 */
function moveTopLevelArtifact(
  report: ReportJson,
  artifactIdx: number,
  targetDomain: string,
): ReportJson {
  const topArtifacts = [...(report.artifacts ?? [])];
  const artifact = topArtifacts[artifactIdx];
  if (!artifact) return report;
  // Remove from top-level
  topArtifacts.splice(artifactIdx, 1);
  const domains = (report.domains ?? []).map((d) => ({ ...d, tasks: [...(d.tasks ?? [])], artifacts: [...(d.artifacts ?? [])] }));
  const targetIdx = domains.findIndex((d) => d.domain === targetDomain);
  const targetBlock = targetIdx >= 0 ? domains[targetIdx] : null;
  if (targetBlock) {
    targetBlock.artifacts.push(artifact);
  } else {
    domains.push({ domain: targetDomain, tasks: [], artifacts: [artifact] });
  }
  const next: ReportJson = { ...report, domains };
  if (topArtifacts.length > 0) {
    next.artifacts = topArtifacts;
  } else {
    delete next.artifacts;
  }
  return next;
}

// ---- Main page ----

export default function ReportPreviewPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const locationState = location.state as PreviewLocationState | null;
  const initialDraft = locationState?.draft ?? null;
  const stateChampionId = locationState?.championId ?? null;

  const [report, setReport] = useState<ReportJson | null>(initialDraft);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);

  // Fetch champion domains for the picker.
  useEffect(() => {
    if (!stateChampionId) return;
    api.domains.listByChampion(stateChampionId)
      .then((domains) => setAvailableDomains(domains.map((d) => d.name)))
      .catch(() => {
        // Non-fatal: picker just won't show if domains can't be loaded.
      });
  }, [stateChampionId]);

  // Stable keys for domain task/artifact rows; initialised once from the draft.
  const [domainTaskKeys] = useState<string[][]>(() =>
    (initialDraft?.domains ?? []).map((d) => (d.tasks ?? []).map(() => nextKey())),
  );
  const [domainArtifactKeys] = useState<string[][]>(() =>
    (initialDraft?.domains ?? []).map((d) => (d.artifacts ?? []).map(() => nextKey())),
  );
  const domainTaskKeysRef = useRef(domainTaskKeys);
  const domainArtifactKeysRef = useRef(domainArtifactKeys);

  // Stable keys for top-level artifacts
  const [topArtifactKeys, setTopArtifactKeys] = useState<string[]>(() =>
    (initialDraft?.artifacts ?? []).map(() => nextKey()),
  );
  const topArtifactKeysRef = useRef(topArtifactKeys);

  // Stable keys for action items
  const [actionItemKeys, setActionItemKeys] = useState<string[]>(() =>
    (initialDraft?.action_items ?? []).map(() => nextKey()),
  );
  const actionItemKeysRef = useRef(actionItemKeys);

  function syncActionItemKeys(keys: string[]) {
    actionItemKeysRef.current = keys;
    setActionItemKeys(keys);
  }

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

  // Move a task from domain[domainIdx][taskIdx] → targetDomain.
  // Keys: remove the task's key from old domain; append a new key to target domain.
  function handleMoveTask(domainIdx: number, taskIdx: number, targetDomain: string) {
    // report is non-null here (null-guarded above); capture to satisfy TS closure analysis.
    const currentDomains = report?.domains ?? [];
    if (targetDomain === currentDomains[domainIdx]?.domain) return;

    setReport((prev) => {
      if (!prev) return prev;
      return moveTask(prev, domainIdx, taskIdx, targetDomain);
    });

    // Mutate key arrays directly (stable refs pattern, matching existing code)
    const newDtk = domainTaskKeysRef.current.map((arr) => [...arr]);
    const removedKey = newDtk[domainIdx]?.splice(taskIdx, 1)?.[0] ?? nextKey();

    const targetDomainIdx = currentDomains.findIndex((d) => d.domain === targetDomain);
    if (targetDomainIdx >= 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      newDtk[targetDomainIdx]!.push(removedKey);
    } else {
      // target domain will be appended as new block
      newDtk.push([removedKey]);
    }
    domainTaskKeysRef.current = newDtk;
    // Also need to keep artifact keys arrays aligned if a new domain block was added
    if (targetDomainIdx < 0) {
      const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
      newDak.push([]);
      domainArtifactKeysRef.current = newDak;
    }
  }

  // Move an artifact from domain[domainIdx][artifactIdx] → targetDomain.
  function handleMoveArtifactInDomain(domainIdx: number, artifactIdx: number, targetDomain: string) {
    const currentDomains = report?.domains ?? [];
    if (targetDomain === currentDomains[domainIdx]?.domain) return;

    setReport((prev) => {
      if (!prev) return prev;
      return moveArtifactInDomain(prev, domainIdx, artifactIdx, targetDomain);
    });

    const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
    const removedKey = newDak[domainIdx]?.splice(artifactIdx, 1)?.[0] ?? nextKey();

    const targetDomainIdx = currentDomains.findIndex((d) => d.domain === targetDomain);
    if (targetDomainIdx >= 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      newDak[targetDomainIdx]!.push(removedKey);
    } else {
      newDak.push([removedKey]);
    }
    domainArtifactKeysRef.current = newDak;
    if (targetDomainIdx < 0) {
      const newDtk = domainTaskKeysRef.current.map((arr) => [...arr]);
      newDtk.push([]);
      domainTaskKeysRef.current = newDtk;
    }
  }

  // Move a top-level artifact to a domain.
  function handleMoveTopLevelArtifact(artifactIdx: number, targetDomain: string) {
    const currentDomains = report?.domains ?? [];
    const newTopKeys = [...topArtifactKeysRef.current];
    newTopKeys.splice(artifactIdx, 1);
    topArtifactKeysRef.current = newTopKeys;
    setTopArtifactKeys(newTopKeys);

    setReport((prev) => {
      if (!prev) return prev;
      return moveTopLevelArtifact(prev, artifactIdx, targetDomain);
    });

    // Ensure domain artifact key arrays stay aligned
    const targetDomainIdx = currentDomains.findIndex((d) => d.domain === targetDomain);
    if (targetDomainIdx >= 0) {
      const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      newDak[targetDomainIdx]!.push(nextKey());
      domainArtifactKeysRef.current = newDak;
    } else {
      const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
      newDak.push([nextKey()]);
      domainArtifactKeysRef.current = newDak;
      const newDtk = domainTaskKeysRef.current.map((arr) => [...arr]);
      newDtk.push([]);
      domainTaskKeysRef.current = newDtk;
    }
  }

  function updateActionItem(idx: number, updated: ReportActionItemLine) {
    setReport((prev) => {
      if (!prev) return prev;
      const action_items = [...(prev.action_items ?? [])];
      action_items[idx] = updated;
      return { ...prev, action_items };
    });
  }

  function addActionItem() {
    syncActionItemKeys([...actionItemKeysRef.current, nextKey()]);
    setReport((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        action_items: [...(prev.action_items ?? []), { text: '' }],
      };
    });
  }

  function removeActionItem(idx: number) {
    const newKeys = [...actionItemKeysRef.current];
    newKeys.splice(idx, 1);
    syncActionItemKeys(newKeys);
    setReport((prev) => {
      if (!prev) return prev;
      const action_items = [...(prev.action_items ?? [])];
      action_items.splice(idx, 1);
      return { ...prev, action_items };
    });
  }

  async function handleConfirm() {
    if (!report) return;

    // Fix 2a: block save if any artifact is missing a type
    const missingTypes = findMissingTypes(report);
    if (missingTypes.length > 0) {
      setError(
        `Cannot save: the following artifact(s) have no type selected — please edit them first: ${missingTypes.join(', ')}`,
      );
      return;
    }

    setConfirming(true);
    setError(null);
    try {
      // The report state object (which includes any edits to action_items,
      // discussion, issues, domains) is sent directly as the POST body.
      const result = await api.reports.create(report);
      navigate(`/teams/${result.report.champion_id}`);
    } catch (err) {
      // Fix 2b: surface backend detail message (ApiError.message is the parsed detail)
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save report. Please try again.',
      );
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

  const topArtifacts = report.artifacts ?? [];

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

        {/* Top-level team-wide artifacts */}
        {topArtifacts.length > 0 && (
          <div className="domain-section">
            <div className="domain-section-header">
              <div className="domain-section-name">Team-wide artifacts</div>
              {availableDomains.length > 0 && (
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  Use the domain picker on each artifact to assign it to a domain.
                </div>
              )}
            </div>
            <div className="subsection-label">Artifact changes</div>
            {topArtifacts.map((a, i) => (
              <EditableArtifactLine
                key={topArtifactKeys[i]}
                line={a}
                availableDomains={availableDomains}
                currentDomain="Team-wide"
                onChange={(updated) => {
                  setReport((prev) => {
                    if (!prev) return prev;
                    const artifacts = [...(prev.artifacts ?? [])];
                    artifacts[i] = updated;
                    return { ...prev, artifacts };
                  });
                }}
                onMoveToDomain={(targetDomain) => handleMoveTopLevelArtifact(i, targetDomain)}
              />
            ))}
          </div>
        )}

        {/* Domain blocks */}
        {(report.domains ?? []).map((block, i) => (
          <DomainSection
            key={block.domain}
            block={block}
            taskKeys={domainTaskKeysRef.current[i] ?? []}
            artifactKeys={domainArtifactKeysRef.current[i] ?? []}
            availableDomains={availableDomains}
            onChange={(updated) => updateDomain(i, updated)}
            onMoveTask={(taskIdx, targetDomain) => handleMoveTask(i, taskIdx, targetDomain)}
            onMoveArtifact={(artifactIdx, targetDomain) => handleMoveArtifactInDomain(i, artifactIdx, targetDomain)}
          />
        ))}

        {/* Action items — editable */}
        <div className="report-card">
          <div className="report-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="report-card-title">Action items</div>
            <button className="btn btn-sm btn-secondary" onClick={addActionItem}>
              + Add
            </button>
          </div>
          <div style={{ padding: '0 0 8px 0' }}>
            {(report.action_items ?? []).length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '8px 20px' }}>
                No action items. Use &ldquo;+ Add&rdquo; to add one.
              </div>
            ) : (
              (report.action_items ?? []).map((item, i) => (
                <EditableActionItemLine
                  key={actionItemKeys[i]}
                  item={item}
                  onChange={(updated) => updateActionItem(i, updated)}
                  onRemove={() => removeActionItem(i)}
                />
              ))
            )}
          </div>
        </div>

        {/* Discussion — inline editable textarea */}
        <div className="report-card">
          <div className="report-card-header">
            <div className="report-card-title">Discussion</div>
          </div>
          <div style={{ padding: '8px 20px 16px' }}>
            <textarea
              className="form-textarea"
              style={{ minHeight: 80, width: '100%', boxSizing: 'border-box' }}
              value={report.discussion ?? ''}
              onChange={(e) =>
                setReport((prev) =>
                  prev ? setOptionalString(prev, 'discussion', e.target.value) : prev,
                )
              }
              placeholder="Free-text discussion notes (optional)"
            />
          </div>
        </div>

        {/* Issues — inline editable textarea */}
        <div className="report-card">
          <div className="report-card-header">
            <div className="report-card-title">Issues flagged</div>
          </div>
          <div style={{ padding: '8px 20px 16px' }}>
            <textarea
              className="form-textarea"
              style={{ minHeight: 80, width: '100%', boxSizing: 'border-box' }}
              value={report.issues ?? ''}
              onChange={(e) =>
                setReport((prev) =>
                  prev ? setOptionalString(prev, 'issues', e.target.value) : prev,
                )
              }
              placeholder="Issues or blockers mentioned (optional)"
            />
          </div>
        </div>

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
