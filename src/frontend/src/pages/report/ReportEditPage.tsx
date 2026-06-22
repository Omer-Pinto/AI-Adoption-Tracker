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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
      <label style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', marginBottom: 0 }}>
        Domain:
      </label>
      <select
        className="form-select"
        style={{ fontSize: 12, padding: '2px 6px', height: 28, minWidth: 120 }}
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

// ---- Task edit block ----

function TaskEditBlock({
  line,
  taskNames,
  artifactNames,
  availableDomains,
  currentDomain,
  onChange,
  onRemove,
  onMoveToDomain,
}: {
  line: ReportTaskLine;
  taskNames: string[];
  artifactNames: string[];
  availableDomains: string[];
  currentDomain: string;
  onChange: (updated: ReportTaskLine) => void;
  onRemove: () => void;
  onMoveToDomain: (targetDomain: string) => void;
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
      <DomainPicker
        currentDomain={currentDomain}
        availableDomains={availableDomains}
        onChange={onMoveToDomain}
      />
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
  availableDomains,
  currentDomain,
  onChange,
  onRemove,
  onMoveToDomain,
}: {
  line: ReportArtifactLine;
  taskNames: string[];
  artifactNames: string[];
  availableDomains: string[];
  currentDomain: string;
  onChange: (updated: ReportArtifactLine) => void;
  onRemove: () => void;
  onMoveToDomain: (targetDomain: string) => void;
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
      <DomainPicker
        currentDomain={currentDomain}
        availableDomains={availableDomains}
        onChange={onMoveToDomain}
      />
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
  availableDomains,
  onChange,
  onRemove,
  onMoveTask,
  onMoveArtifact,
}: {
  block: ReportDomainBlock;
  taskKeys: string[];
  artifactKeys: string[];
  taskNames: string[];
  artifactNames: string[];
  availableDomains: string[];
  onChange: (updated: ReportDomainBlock, updatedTaskKeys: string[], updatedArtifactKeys: string[]) => void;
  onRemove: () => void;
  onMoveTask: (taskIdx: number, targetDomain: string) => void;
  onMoveArtifact: (artifactIdx: number, targetDomain: string) => void;
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
          availableDomains={availableDomains}
          currentDomain={block.domain}
          onChange={(updated) => updateTask(i, updated)}
          onRemove={() => removeTask(i)}
          onMoveToDomain={(targetDomain) => onMoveTask(i, targetDomain)}
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
          availableDomains={availableDomains}
          currentDomain={block.domain}
          onChange={(updated) => updateArtifact(i, updated)}
          onRemove={() => removeArtifact(i)}
          onMoveToDomain={(targetDomain) => onMoveArtifact(i, targetDomain)}
        />
      ))}
      <button className="btn btn-sm btn-secondary" onClick={addArtifact}>
        + Add artifact
      </button>
    </div>
  );
}

// ---- Pure move helpers ----

function moveTask(
  report: ReportJson,
  domainIdx: number,
  taskIdx: number,
  targetDomain: string,
): ReportJson {
  const domains = (report.domains ?? []).map((d) => ({
    ...d,
    tasks: [...(d.tasks ?? [])],
    artifacts: [...(d.artifacts ?? [])],
  }));
  const sourceDomain = domains[domainIdx];
  if (!sourceDomain) return report;
  const task = sourceDomain.tasks[taskIdx];
  if (!task) return report;
  sourceDomain.tasks.splice(taskIdx, 1);
  const targetIdx = domains.findIndex((d) => d.domain === targetDomain);
  const targetBlock = targetIdx >= 0 ? domains[targetIdx] : null;
  if (targetBlock) {
    targetBlock.tasks.push(task);
  } else {
    domains.push({ domain: targetDomain, tasks: [task], artifacts: [] });
  }
  return { ...report, domains };
}

function moveArtifactInDomain(
  report: ReportJson,
  domainIdx: number,
  artifactIdx: number,
  targetDomain: string,
): ReportJson {
  const domains = (report.domains ?? []).map((d) => ({
    ...d,
    tasks: [...(d.tasks ?? [])],
    artifacts: [...(d.artifacts ?? [])],
  }));
  const sourceDomain = domains[domainIdx];
  if (!sourceDomain) return report;
  const artifact = sourceDomain.artifacts[artifactIdx];
  if (!artifact) return report;
  sourceDomain.artifacts.splice(artifactIdx, 1);
  const targetIdx = domains.findIndex((d) => d.domain === targetDomain);
  const targetBlock = targetIdx >= 0 ? domains[targetIdx] : null;
  if (targetBlock) {
    targetBlock.artifacts.push(artifact);
  } else {
    domains.push({ domain: targetDomain, tasks: [], artifacts: [artifact] });
  }
  return { ...report, domains };
}

function moveTopLevelArtifact(
  report: ReportJson,
  artifactIdx: number,
  targetDomain: string,
): ReportJson {
  const topArtifacts = [...(report.artifacts ?? [])];
  const artifact = topArtifacts[artifactIdx];
  if (!artifact) return report;
  topArtifacts.splice(artifactIdx, 1);
  const domains = (report.domains ?? []).map((d) => ({
    ...d,
    tasks: [...(d.tasks ?? [])],
    artifacts: [...(d.artifacts ?? [])],
  }));
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

export default function ReportEditPage() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();

  const [report, setReport] = useState<ReportJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [taskNames, setTaskNames] = useState<string[]>([]);
  const [artifactNames, setArtifactNames] = useState<string[]>([]);
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);

  // Stable keys for domains and action items to avoid index-as-key corruption.
  // domainTaskKeys[i] / domainArtifactKeys[i] hold the per-item key arrays for domain i.
  const [domainKeys, setDomainKeys] = useState<string[]>([]);
  const [domainTaskKeys, setDomainTaskKeys] = useState<string[][]>([]);
  const [domainArtifactKeys, setDomainArtifactKeys] = useState<string[][]>([]);
  const [actionItemKeys, setActionItemKeys] = useState<string[]>([]);
  const [topArtifactKeys, setTopArtifactKeys] = useState<string[]>([]);

  // Keep a ref so mutators can read current key state without stale closures.
  const domainKeysRef = useRef<string[]>([]);
  const domainTaskKeysRef = useRef<string[][]>([]);
  const domainArtifactKeysRef = useRef<string[][]>([]);
  const actionItemKeysRef = useRef<string[]>([]);
  const topArtifactKeysRef = useRef<string[]>([]);
  // We need to read the current report domains list for move key calculations.
  const reportRef = useRef<ReportJson | null>(null);

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

  function syncTopArtifactKeys(tak: string[]) {
    topArtifactKeysRef.current = tak;
    setTopArtifactKeys(tak);
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
        reportRef.current = parsed;
        setTaskNames(tasks.map((t) => t.name));
        setArtifactNames(artifacts.map((a) => a.name));
        // Assign stable keys for all existing blocks/items.
        const dk = (parsed.domains ?? []).map(() => nextKey());
        const dtk = (parsed.domains ?? []).map((d) => (d.tasks ?? []).map(() => nextKey()));
        const dak = (parsed.domains ?? []).map((d) => (d.artifacts ?? []).map(() => nextKey()));
        const aik = (parsed.action_items ?? []).map(() => nextKey());
        const tak = (parsed.artifacts ?? []).map(() => nextKey());
        syncDomainKeys(dk, dtk, dak);
        syncActionItemKeys(aik);
        syncTopArtifactKeys(tak);
        // Fetch champion's domains for the domain picker.
        return api.domains.listByChampion(saved.champion_id);
      })
      .then((championDomains) => {
        setAvailableDomains(championDomains.map((d) => d.name));
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
    for (const a of r.artifacts ?? []) {
      if (!a.type) missing.push(a.artifact || '(unnamed artifact)');
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
      const next = {
        ...prev,
        domains: [...(prev.domains ?? []), { domain: 'New domain', tasks: [], artifacts: [] }],
      };
      reportRef.current = next;
      return next;
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
      const next = { ...prev, domains };
      reportRef.current = next;
      return next;
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
      const next = { ...prev, domains };
      reportRef.current = next;
      return next;
    });
  }

  // Move task from domain[domainIdx][taskIdx] → targetDomain.
  function handleMoveTask(domainIdx: number, taskIdx: number, targetDomain: string) {
    const currentDomains = reportRef.current?.domains ?? [];
    if (targetDomain === currentDomains[domainIdx]?.domain) return;

    const newDtk = domainTaskKeysRef.current.map((arr) => [...arr]);
    const removedKey = newDtk[domainIdx]?.splice(taskIdx, 1)?.[0] ?? nextKey();
    const targetDomainIdx = currentDomains.findIndex((d) => d.domain === targetDomain);
    const targetDtkArr = targetDomainIdx >= 0 ? newDtk[targetDomainIdx] : null;
    if (targetDtkArr) {
      targetDtkArr.push(removedKey);
    } else {
      newDtk.push([removedKey]);
    }
    const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
    if (targetDomainIdx < 0) newDak.push([]);
    const newDk = targetDomainIdx < 0
      ? [...domainKeysRef.current, nextKey()]
      : [...domainKeysRef.current];
    syncDomainKeys(newDk, newDtk, newDak);

    setReport((prev) => {
      if (!prev) return prev;
      const next = moveTask(prev, domainIdx, taskIdx, targetDomain);
      reportRef.current = next;
      return next;
    });
  }

  // Move artifact from domain[domainIdx][artifactIdx] → targetDomain.
  function handleMoveArtifactInDomain(domainIdx: number, artifactIdx: number, targetDomain: string) {
    const currentDomains = reportRef.current?.domains ?? [];
    if (targetDomain === currentDomains[domainIdx]?.domain) return;

    const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
    const removedKey = newDak[domainIdx]?.splice(artifactIdx, 1)?.[0] ?? nextKey();
    const targetDomainIdx = currentDomains.findIndex((d) => d.domain === targetDomain);
    const targetDakArr = targetDomainIdx >= 0 ? newDak[targetDomainIdx] : null;
    if (targetDakArr) {
      targetDakArr.push(removedKey);
    } else {
      newDak.push([removedKey]);
    }
    const newDtk = domainTaskKeysRef.current.map((arr) => [...arr]);
    if (targetDomainIdx < 0) newDtk.push([]);
    const newDk = targetDomainIdx < 0
      ? [...domainKeysRef.current, nextKey()]
      : [...domainKeysRef.current];
    syncDomainKeys(newDk, newDtk, newDak);

    setReport((prev) => {
      if (!prev) return prev;
      const next = moveArtifactInDomain(prev, domainIdx, artifactIdx, targetDomain);
      reportRef.current = next;
      return next;
    });
  }

  // Move top-level artifact to a domain.
  function handleMoveTopLevelArtifact(artifactIdx: number, targetDomain: string) {
    const currentDomains = reportRef.current?.domains ?? [];
    const newTopKeys = [...topArtifactKeysRef.current];
    newTopKeys.splice(artifactIdx, 1);
    syncTopArtifactKeys(newTopKeys);

    const targetDomainIdx = currentDomains.findIndex((d) => d.domain === targetDomain);
    const newDak = domainArtifactKeysRef.current.map((arr) => [...arr]);
    const targetDakArrTop = targetDomainIdx >= 0 ? newDak[targetDomainIdx] : null;
    if (targetDakArrTop) {
      targetDakArrTop.push(nextKey());
    } else {
      newDak.push([nextKey()]);
    }
    const newDtk = domainTaskKeysRef.current.map((arr) => [...arr]);
    if (targetDomainIdx < 0) newDtk.push([]);
    const newDk = targetDomainIdx < 0
      ? [...domainKeysRef.current, nextKey()]
      : [...domainKeysRef.current];
    syncDomainKeys(newDk, newDtk, newDak);

    setReport((prev) => {
      if (!prev) return prev;
      const next = moveTopLevelArtifact(prev, artifactIdx, targetDomain);
      reportRef.current = next;
      return next;
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

  const topArtifacts = report.artifacts ?? [];

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

          {/* Top-level team-wide artifacts */}
          {topArtifacts.length > 0 && (
            <div className="form-section" style={{ marginTop: 16 }}>
              <div className="form-section-title">Team-wide artifacts</div>
              <div className="form-section-subtitle">
                These artifacts are not assigned to any domain. Use the domain picker to move them.
              </div>
              {topArtifacts.map((a, i) => (
                <ArtifactEditBlock
                  key={topArtifactKeys[i]}
                  line={a}
                  taskNames={taskNames}
                  artifactNames={artifactNames}
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
                  onRemove={() => {
                    const newTopKeys = [...topArtifactKeysRef.current];
                    newTopKeys.splice(i, 1);
                    syncTopArtifactKeys(newTopKeys);
                    setReport((prev) => {
                      if (!prev) return prev;
                      const artifacts = [...(prev.artifacts ?? [])];
                      artifacts.splice(i, 1);
                      const next: ReportJson = { ...prev };
                      if (artifacts.length > 0) {
                        next.artifacts = artifacts;
                      } else {
                        delete next.artifacts;
                      }
                      return next;
                    });
                  }}
                  onMoveToDomain={(targetDomain) => handleMoveTopLevelArtifact(i, targetDomain)}
                />
              ))}
            </div>
          )}

          {/* Domain blocks */}
          {(report.domains ?? []).map((block, i) => (
            <DomainEditSection
              key={domainKeys[i]}
              block={block}
              taskKeys={domainTaskKeys[i] ?? []}
              artifactKeys={domainArtifactKeys[i] ?? []}
              taskNames={taskNames}
              artifactNames={artifactNames}
              availableDomains={availableDomains}
              onChange={(updated, updatedTaskKeys, updatedArtifactKeys) => updateDomain(i, updated, updatedTaskKeys, updatedArtifactKeys)}
              onRemove={() => removeDomain(i)}
              onMoveTask={(taskIdx, targetDomain) => handleMoveTask(i, taskIdx, targetDomain)}
              onMoveArtifact={(artifactIdx, targetDomain) => handleMoveArtifactInDomain(i, artifactIdx, targetDomain)}
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
