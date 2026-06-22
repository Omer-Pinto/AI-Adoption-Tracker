import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';
import type {
  Artifact,
  ArtifactChangeKind,
  ArtifactType,
  ReportArtifactLine,
  ReportDomainBlock,
  ReportJson,
  ReportTaskLine,
  Task,
  TaskStatus,
} from '@/types';
import { MentionInput } from './MentionInput';
import {
  makeActionItemLine,
  makeArtifactLine,
  makeTaskLine,
  setOptionalString,
  setParticipants,
} from './reportUtils';

// Monotonic counter for generating stable block/item keys within this module.
let _keyCounter = 0;
function nextKey(): string {
  return String(++_keyCounter);
}

// Route: "/reports/:reportId/edit"
// Loads saved report, binds to structured form (no raw notes), saves via PATCH.
// @-mention in task name fields fuzzy-finds all task names (api.views.tasks()).
// #-mention in artifact name fields fuzzy-finds all artifact names.

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

// ---- Task edit block ----

function TaskEditBlock({
  line,
  taskNames,
  artifactNames,
  onChange,
  onRemove,
}: {
  line: ReportTaskLine;
  taskNames: string[];
  artifactNames: string[];
  onChange: (updated: ReportTaskLine) => void;
  onRemove: () => void;
}) {
  const [taskName, setTaskName] = useState(line.task);
  const [status, setStatus] = useState<TaskStatus>(line.status);
  const [owner, setOwner] = useState(line.owner ?? '');
  const [note, setNote] = useState(line.note ?? '');

  // Propagate changes upward on each field edit
  function emit(
    t = taskName,
    s = status,
    o = owner,
    n = note,
  ) {
    onChange(makeTaskLine(t, s, o, n, line.finished_on));
  }

  return (
    <div className="task-edit-block">
      <div className="form-grid-2" style={{ marginBottom: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Task name (@-mention to find existing)</label>
          <MentionInput
            value={taskName}
            onValueChange={(v) => { setTaskName(v); emit(v); }}
            taskNames={taskNames}
            artifactNames={artifactNames}
            placeholder="Task name…"
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Status at this meeting</label>
          <select
            className="form-select"
            value={status}
            onChange={(e) => { const s = e.target.value as TaskStatus; setStatus(s); emit(undefined, s); }}
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
            onChange={(e) => { setOwner(e.target.value); emit(undefined, undefined, e.target.value); }}
            placeholder="optional"
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Change note</label>
          <input
            type="text"
            className="form-input"
            value={note}
            onChange={(e) => { setNote(e.target.value); emit(undefined, undefined, undefined, e.target.value); }}
            placeholder="optional"
          />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-danger-outline" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ---- Artifact edit block ----

function ArtifactEditBlock({
  line,
  taskNames,
  artifactNames,
  onChange,
  onRemove,
}: {
  line: ReportArtifactLine;
  taskNames: string[];
  artifactNames: string[];
  onChange: (updated: ReportArtifactLine) => void;
  onRemove: () => void;
}) {
  const [artifactName, setArtifactName] = useState(line.artifact);
  const [type, setType] = useState(line.type ?? '');
  const [changeKind, setChangeKind] = useState(line.change_kind ?? '');
  const [tagsRaw, setTagsRaw] = useState((line.tags ?? []).join(', '));
  const [note, setNote] = useState(line.note ?? '');

  function emit(
    a = artifactName,
    t = type,
    ck = changeKind,
    tr = tagsRaw,
    n = note,
  ) {
    onChange(makeArtifactLine(a, t, ck, tr, n));
  }

  return (
    <div className="artifact-edit-block">
      <div className="form-grid-2" style={{ marginBottom: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Artifact name (#-mention to find existing)</label>
          <MentionInput
            value={artifactName}
            onValueChange={(v) => { setArtifactName(v); emit(v); }}
            taskNames={taskNames}
            artifactNames={artifactNames}
            placeholder="Artifact name…"
          />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label className="form-label">Type</label>
          <select
            className="form-select"
            value={type}
            onChange={(e) => { setType(e.target.value); emit(undefined, e.target.value); }}
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
            onChange={(e) => { setChangeKind(e.target.value); emit(undefined, undefined, e.target.value); }}
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
            onChange={(e) => { setTagsRaw(e.target.value); emit(undefined, undefined, undefined, e.target.value); }}
            placeholder="under_test, in_use_by_team, …"
          />
        </div>
      </div>
      <div className="form-row" style={{ marginBottom: 10 }}>
        <label className="form-label">Change note</label>
        <input
          type="text"
          className="form-input"
          value={note}
          onChange={(e) => { setNote(e.target.value); emit(undefined, undefined, undefined, undefined, e.target.value); }}
          placeholder="optional"
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-sm btn-danger-outline" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ---- Domain edit section ----

function DomainEditSection({
  block,
  taskKeys,
  artifactKeys,
  taskNames,
  artifactNames,
  onChange,
  onRemove,
}: {
  block: ReportDomainBlock;
  taskKeys: string[];
  artifactKeys: string[];
  taskNames: string[];
  artifactNames: string[];
  onChange: (updated: ReportDomainBlock, updatedTaskKeys: string[], updatedArtifactKeys: string[]) => void;
  onRemove: () => void;
}) {
  function addTask() {
    const tasks: ReportTaskLine[] = [...(block.tasks ?? []), { task: '', status: 'planned' }];
    onChange({ ...block, tasks }, [...taskKeys, nextKey()], artifactKeys);
  }

  function addArtifact() {
    const artifacts: ReportArtifactLine[] = [...(block.artifacts ?? []), { artifact: '' }];
    onChange({ ...block, artifacts }, taskKeys, [...artifactKeys, nextKey()]);
  }

  function updateTask(idx: number, updated: ReportTaskLine) {
    const tasks = [...(block.tasks ?? [])];
    tasks[idx] = updated;
    onChange({ ...block, tasks }, taskKeys, artifactKeys);
  }

  function removeTask(idx: number) {
    const tasks = [...(block.tasks ?? [])];
    tasks.splice(idx, 1);
    const newTaskKeys = [...taskKeys];
    newTaskKeys.splice(idx, 1);
    onChange({ ...block, tasks }, newTaskKeys, artifactKeys);
  }

  function updateArtifact(idx: number, updated: ReportArtifactLine) {
    const artifacts = [...(block.artifacts ?? [])];
    artifacts[idx] = updated;
    onChange({ ...block, artifacts }, taskKeys, artifactKeys);
  }

  function removeArtifact(idx: number) {
    const artifacts = [...(block.artifacts ?? [])];
    artifacts.splice(idx, 1);
    const newArtifactKeys = [...artifactKeys];
    newArtifactKeys.splice(idx, 1);
    onChange({ ...block, artifacts }, taskKeys, newArtifactKeys);
  }

  return (
    <div className="form-section" style={{ marginTop: 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}
      >
        <div className="form-section-title" style={{ marginBottom: 0 }}>
          Domain: {block.domain}
        </div>
        <button className="btn btn-sm btn-danger-outline" onClick={onRemove}>
          Remove domain
        </button>
      </div>
      <div className="form-section-subtitle">
        Edit task statuses and notes, or add new tasks and artifacts for this domain.
      </div>

      <div className="form-row">
        <label className="form-label">Domain name</label>
        <input
          type="text"
          className="form-input"
          value={block.domain}
          onChange={(e) => onChange({ ...block, domain: e.target.value }, taskKeys, artifactKeys)}
        />
      </div>

      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 12, color: '#374151' }}>
        Tasks
      </div>
      {(block.tasks ?? []).map((t, i) => (
        <TaskEditBlock
          key={taskKeys[i]}
          line={t}
          taskNames={taskNames}
          artifactNames={artifactNames}
          onChange={(updated) => updateTask(i, updated)}
          onRemove={() => removeTask(i)}
        />
      ))}
      <button
        className="btn btn-sm btn-secondary"
        style={{ marginBottom: 16 }}
        onClick={addTask}
      >
        + Add task
      </button>

      <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 12, color: '#374151' }}>
        Artifact changes
      </div>
      {(block.artifacts ?? []).map((a, i) => (
        <ArtifactEditBlock
          key={artifactKeys[i]}
          line={a}
          taskNames={taskNames}
          artifactNames={artifactNames}
          onChange={(updated) => updateArtifact(i, updated)}
          onRemove={() => removeArtifact(i)}
        />
      ))}
      <button className="btn btn-sm btn-secondary" onClick={addArtifact}>
        + Add artifact
      </button>
    </div>
  );
}

// ---- Main page ----

export default function ReportEditPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<ReportJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [taskNames, setTaskNames] = useState<string[]>([]);
  const [artifactNames, setArtifactNames] = useState<string[]>([]);

  // Stable keys for domains and action items to avoid index-as-key corruption.
  // domainTaskKeys[i] / domainArtifactKeys[i] hold the per-item key arrays for domain i.
  const [domainKeys, setDomainKeys] = useState<string[]>([]);
  const [domainTaskKeys, setDomainTaskKeys] = useState<string[][]>([]);
  const [domainArtifactKeys, setDomainArtifactKeys] = useState<string[][]>([]);
  const [actionItemKeys, setActionItemKeys] = useState<string[]>([]);

  // Keep a ref so mutators can read current key state without stale closures.
  const domainKeysRef = useRef<string[]>([]);
  const domainTaskKeysRef = useRef<string[][]>([]);
  const domainArtifactKeysRef = useRef<string[][]>([]);
  const actionItemKeysRef = useRef<string[]>([]);

  function syncDomainKeys(dk: string[], dtk: string[][], dak: string[][]) {
    domainKeysRef.current = dk;
    domainTaskKeysRef.current = dtk;
    domainArtifactKeysRef.current = dak;
    setDomainKeys(dk);
    setDomainTaskKeys(dtk);
    setDomainArtifactKeys(dak);
  }

  function syncActionItemKeys(aik: string[]) {
    actionItemKeysRef.current = aik;
    setActionItemKeys(aik);
  }

  useEffect(() => {
    if (!reportId) return;
    Promise.all([
      api.reports.get(Number(reportId)),
      api.views.tasks(),
      api.views.artifacts(),
    ])
      .then(([{ report: saved }, tasks, artifacts]: [
        { report: { id: number; champion_id: number; meeting_date: string; report_json: string; schema_version: number } },
        Task[],
        Artifact[],
      ]) => {
        const parsed = JSON.parse(saved.report_json) as ReportJson;
        setReport(parsed);
        setTaskNames(tasks.map((t) => t.name));
        setArtifactNames(artifacts.map((a) => a.name));
        // Assign stable keys for all existing blocks/items.
        const dk = (parsed.domains ?? []).map(() => nextKey());
        const dtk = (parsed.domains ?? []).map((d) => (d.tasks ?? []).map(() => nextKey()));
        const dak = (parsed.domains ?? []).map((d) => (d.artifacts ?? []).map(() => nextKey()));
        const aik = (parsed.action_items ?? []).map(() => nextKey());
        syncDomainKeys(dk, dtk, dak);
        syncActionItemKeys(aik);
      })
      .catch(() => setError('Failed to load report.'))
      .finally(() => setLoading(false));
  }, [reportId]);

  // Validate: any artifact line missing a type blocks save.
  function findMissingTypes(r: ReportJson): string[] {
    const missing: string[] = [];
    for (const domain of r.domains ?? []) {
      for (const a of domain.artifacts ?? []) {
        if (!a.type) missing.push(a.artifact || '(unnamed artifact)');
      }
    }
    return missing;
  }

  async function handleSave() {
    if (!report || !reportId) return;

    const missingTypes = findMissingTypes(report);
    if (missingTypes.length > 0) {
      setError(
        `Cannot save: the following artifact(s) have no type selected — please edit them first: ${missingTypes.join(', ')}`,
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { report: saved } = await api.reports.update(Number(reportId), report);
      navigate(`/teams/${saved.champion_id}`);
    } catch (err) {
      // Surface the backend detail message (ApiError.message is the parsed detail).
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to save report. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  function addDomain() {
    const newDomainKey = nextKey();
    syncDomainKeys(
      [...domainKeysRef.current, newDomainKey],
      [...domainTaskKeysRef.current, []],
      [...domainArtifactKeysRef.current, []],
    );
    setReport((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        domains: [...(prev.domains ?? []), { domain: 'New domain', tasks: [], artifacts: [] }],
      };
    });
  }

  function updateDomain(idx: number, updated: ReportDomainBlock, updatedTaskKeys: string[], updatedArtifactKeys: string[]) {
    const newDtk = [...domainTaskKeysRef.current];
    newDtk[idx] = updatedTaskKeys;
    const newDak = [...domainArtifactKeysRef.current];
    newDak[idx] = updatedArtifactKeys;
    syncDomainKeys(domainKeysRef.current, newDtk, newDak);
    setReport((prev) => {
      if (!prev) return prev;
      const domains = [...(prev.domains ?? [])];
      domains[idx] = updated;
      return { ...prev, domains };
    });
  }

  function removeDomain(idx: number) {
    const newDk = [...domainKeysRef.current];
    newDk.splice(idx, 1);
    const newDtk = [...domainTaskKeysRef.current];
    newDtk.splice(idx, 1);
    const newDak = [...domainArtifactKeysRef.current];
    newDak.splice(idx, 1);
    syncDomainKeys(newDk, newDtk, newDak);
    setReport((prev) => {
      if (!prev) return prev;
      const domains = [...(prev.domains ?? [])];
      domains.splice(idx, 1);
      return { ...prev, domains };
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

  function updateActionItem(
    idx: number,
    field: 'text' | 'owner' | 'due_date',
    value: string,
  ) {
    setReport((prev) => {
      if (!prev) return prev;
      const action_items = [...(prev.action_items ?? [])];
      const item = action_items[idx];
      if (!item) return prev;
      action_items[idx] = makeActionItemLine(
        field === 'text' ? value : item.text,
        field === 'owner' ? value : (item.owner ?? ''),
        field === 'due_date' ? value : (item.due_date ?? ''),
        item.domain,
      );
      return { ...prev, action_items };
    });
  }

  function removeActionItem(idx: number) {
    const newAik = [...actionItemKeysRef.current];
    newAik.splice(idx, 1);
    syncActionItemKeys(newAik);
    setReport((prev) => {
      if (!prev) return prev;
      const action_items = [...(prev.action_items ?? [])];
      action_items.splice(idx, 1);
      return { ...prev, action_items };
    });
  }

  // ---- Render states ----

  if (loading) {
    return (
      <>
        <div className="top-bar">
          <div><span className="top-bar-title">Edit Report</span></div>
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
          <div><span className="top-bar-title">Edit Report</span></div>
        </div>
        <div className="page-body">
          <div className="blocker-banner">
            <div className="blocker-banner-label">Error</div>
            {error}
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
          <button
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={() => void handleSave()}
          >
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
          <strong>Editing a saved report.</strong> You are editing the structured fields, not the
          original raw notes. On save, task and artifact records will be recomputed from this
          report&apos;s data.
        </div>

        {error && (
          <div className="blocker-banner" style={{ marginBottom: 16 }}>
            <div className="blocker-banner-label">Error</div>
            {error}
          </div>
        )}

        <div className="form-shell" style={{ maxWidth: 860 }}>

          {/* Meeting info */}
          <div className="form-section">
            <div className="form-section-title">Meeting info</div>

            <div className="form-grid-2" style={{ marginBottom: 14 }}>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label">Champion</label>
                <input
                  type="text"
                  className="form-input prefilled"
                  value={report.champion}
                  readOnly
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="form-label form-label-required">Meeting date</label>
                <input
                  type="date"
                  className="form-input"
                  value={report.meeting_date}
                  onChange={(e) =>
                    setReport((prev) => prev ? { ...prev, meeting_date: e.target.value } : prev)
                  }
                />
              </div>
            </div>

            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="form-label">Participants (comma-separated)</label>
              <input
                type="text"
                className="form-input"
                value={(report.participants ?? []).join(', ')}
                onChange={(e) =>
                  setReport((prev) => prev ? setParticipants(prev, e.target.value) : prev)
                }
                placeholder="optional"
              />
            </div>
          </div>

          {/* Domain blocks */}
          {(report.domains ?? []).map((block, i) => (
            <DomainEditSection
              key={domainKeys[i]}
              block={block}
              taskKeys={domainTaskKeys[i] ?? []}
              artifactKeys={domainArtifactKeys[i] ?? []}
              taskNames={taskNames}
              artifactNames={artifactNames}
              onChange={(updated, updatedTaskKeys, updatedArtifactKeys) => updateDomain(i, updated, updatedTaskKeys, updatedArtifactKeys)}
              onRemove={() => removeDomain(i)}
            />
          ))}

          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-sm btn-secondary" onClick={addDomain}>
              + Add domain block
            </button>
          </div>

          {/* Action items */}
          <div className="form-section" style={{ marginTop: 16 }}>
            <div className="form-section-title">Action items</div>

            {(report.action_items ?? []).map((item, i) => (
              <div key={actionItemKeys[i]} className="action-edit-row">
                <div style={{ flex: 1 }}>
                  <label className="form-label">Action</label>
                  <input
                    type="text"
                    className="form-input"
                    value={item.text}
                    onChange={(e) => updateActionItem(i, 'text', e.target.value)}
                    placeholder="Action text…"
                  />
                </div>
                <div style={{ width: 140 }}>
                  <label className="form-label">Owner</label>
                  <input
                    type="text"
                    className="form-input"
                    value={item.owner ?? ''}
                    onChange={(e) => updateActionItem(i, 'owner', e.target.value)}
                    placeholder="optional"
                  />
                </div>
                <div style={{ width: 130 }}>
                  <label className="form-label">Due date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={item.due_date ?? ''}
                    onChange={(e) => updateActionItem(i, 'due_date', e.target.value)}
                  />
                </div>
                <div style={{ alignSelf: 'flex-end', paddingBottom: 0 }}>
                  <button
                    className="btn btn-sm btn-danger-outline"
                    onClick={() => removeActionItem(i)}
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}

            <button className="btn btn-sm btn-secondary" onClick={addActionItem}>
              + Add action item
            </button>
          </div>

          {/* Discussion */}
          <div className="form-section" style={{ marginTop: 16 }}>
            <div className="form-section-title">Discussion</div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="form-label">Free-text discussion notes</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: 80 }}
                value={report.discussion ?? ''}
                onChange={(e) =>
                  setReport((prev) =>
                    prev ? setOptionalString(prev, 'discussion', e.target.value) : prev,
                  )
                }
                placeholder="optional"
              />
            </div>
          </div>

          {/* Issues */}
          <div className="form-section" style={{ marginTop: 16 }}>
            <div className="form-section-title">Issues flagged</div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label className="form-label">Issues or blockers mentioned</label>
              <textarea
                className="form-textarea"
                style={{ minHeight: 80 }}
                value={report.issues ?? ''}
                onChange={(e) =>
                  setReport((prev) =>
                    prev ? setOptionalString(prev, 'issues', e.target.value) : prev,
                  )
                }
                placeholder="optional"
              />
            </div>
          </div>

          {/* Save / Cancel */}
          <div className="form-actions-bottom">
            <button
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
