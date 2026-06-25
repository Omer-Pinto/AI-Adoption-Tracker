// Shared flat report-editor primitives — the centerpiece of the rebuilt
// report editor. Implements the APPROVED prototype design
// (prototype/report-editor-prototype.html) in real React/TS against the FLAT
// `ReportJson` shape (src/backend/models.py).
//
// Exports:
//   * FlatReportEditor — the full editable report body (flat Tasks/Artifacts
//     tables, action items, discussion/issues lists). Used by Preview + Edit.
//   * stripReportForSave — produce a backend-clean `ReportJson` (extra="forbid").
//   * SVG task/artifact icons reused from the prototype.
//
// id semantics: `line.id` SET = MATCHED (name links to the detail route);
// `line.id` null/absent = NEW (two-line editor, NEW badge, "link existing…").
// Domain placement: `domain_id` + `domain` set together, both cleared for
// unplaced/team-wide.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import type {
  ArtifactChangeKind,
  ArtifactType,
  EntityPickerArtifact,
  EntityPickerTask,
  ReportActionItemLine,
  ReportArtifactLine,
  ReportJson,
  ReportTaskLine,
  TaskStatus,
  TeamEntities,
} from '@/types';

// ── option lists (enum values authoritative from models.py) ─────────────────

interface StatusOpt {
  v: TaskStatus;
  l: string;
  cls: string;
}
export const STATUS_OPTS: StatusOpt[] = [
  { v: 'planned', l: 'Planned', cls: 'sd-planned' },
  { v: 'in-progress', l: 'In progress', cls: 'sd-in-progress' },
  { v: 'finished_successfully', l: 'Finished successfully', cls: 'sd-finished-ok' },
  { v: 'finished_with_issues', l: 'Finished w/ issues', cls: 'sd-finished-issues' },
  { v: 'blocked', l: 'Blocked', cls: 'sd-blocked' },
  { v: 'abandoned', l: 'Abandoned', cls: 'sd-abandoned' },
];
function statusCls(v: TaskStatus): string {
  return STATUS_OPTS.find((s) => s.v === v)?.cls ?? '';
}

export const CHANGE_OPTS: ArtifactChangeKind[] = ['added', 'updated', 'retired', 'moved'];
export const TYPE_OPTS: ArtifactType[] = ['agent', 'skill', 'hook', 'context'];

// ── domain colors — one distinct palette entry per domain (by index) ────────

interface DomainColor {
  bg: string;
  border: string;
  text: string;
  dot: string;
}
const DOMAIN_PALETTE: DomainColor[] = [
  { bg: '#eff6ff', border: '#bfdbfe', text: '#1d4ed8', dot: '#3b82f6' },
  { bg: '#f5f3ff', border: '#ddd6fe', text: '#5b21b6', dot: '#8b5cf6' },
  { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46', dot: '#10b981' },
  { bg: '#fffbeb', border: '#fde68a', text: '#92400e', dot: '#f59e0b' },
  { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', dot: '#ef4444' },
  { bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e', dot: '#14b8a6' },
  { bg: '#fdf4ff', border: '#f5d0fe', text: '#86198f', dot: '#d946ef' },
  { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412', dot: '#f97316' },
];
const DOMAIN_GENERAL: DomainColor = { bg: '#f9fafb', border: '#e5e7eb', text: '#6b7280', dot: '#9ca3af' };

/** A domain option for the per-row picker (the champion's real domains). */
export interface DomainOption {
  id: number;
  name: string;
}

function colorForDomain(name: string | null | undefined, domains: DomainOption[]): DomainColor {
  if (!name) return DOMAIN_GENERAL;
  const i = domains.findIndex((d) => d.name === name);
  return i >= 0 ? (DOMAIN_PALETTE[i % DOMAIN_PALETTE.length] as DomainColor) : DOMAIN_GENERAL;
}

// ── SVG icons (reused from the prototype) ───────────────────────────────────

export function TaskIcon() {
  return (
    <svg className="ent-ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8.2 7 10.2 11 5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function ArtifactIcon() {
  return (
    <svg className="ent-ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M8 2.2 13.6 5 8 7.8 2.4 5 8 2.2Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2.4 8 8 10.8 13.6 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.4 11 8 13.8 13.6 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── domain legend + per-row domain select ───────────────────────────────────

function DomainLegend({ domains }: { domains: DomainOption[] }) {
  return (
    <div className="domain-legend">
      <span className="dl-label">Domains:</span>
      {domains.map((d, i) => {
        const c = DOMAIN_PALETTE[i % DOMAIN_PALETTE.length] as DomainColor;
        return (
          <span key={d.id} className="dl-item">
            <span className="dl-dot" style={{ background: c.dot }} />
            {d.name}
          </span>
        );
      })}
      <span className="dl-item">
        <span className="dl-dot" style={{ background: DOMAIN_GENERAL.dot }} />
        Unplaced / General
      </span>
    </div>
  );
}

function DomainSelect({
  domain,
  domains,
  onChange,
}: {
  domain: string | null | undefined;
  domains: DomainOption[];
  // null target = unplaced/team-wide (clears both domain_id and domain)
  onChange: (next: DomainOption | null) => void;
}) {
  const c = colorForDomain(domain, domains);
  return (
    <select
      className="dom-sel"
      style={{ background: c.bg, color: c.text, borderColor: c.border }}
      value={domain ?? ''}
      title="Set domain"
      onChange={(e) => {
        const picked = domains.find((d) => d.name === e.target.value) ?? null;
        onChange(picked);
      }}
    >
      <option value="">Unplaced / General</option>
      {domains.map((d) => (
        <option key={d.id} value={d.name}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

// ── status control (neutral select + colored leading dot) ───────────────────

function StatusControl({
  value,
  onChange,
}: {
  value: TaskStatus;
  onChange: (v: TaskStatus) => void;
}) {
  return (
    <span className="status-wrap">
      <span className={`status-dot ${statusCls(value)}`} />
      <select
        className="status-sel"
        value={value}
        onChange={(e) => onChange(e.target.value as TaskStatus)}
      >
        {STATUS_OPTS.map((s) => (
          <option key={s.v} value={s.v}>
            {s.l}
          </option>
        ))}
      </select>
    </span>
  );
}

// ── link-existing picker (NEW row → pick a real entity → set id) ────────────

interface LinkPickerProps<T> {
  anchorRect: DOMRect;
  items: T[];
  label: string;
  renderMeta: (item: T) => string;
  onPick: (item: T) => void;
  onClose: () => void;
}

function LinkPicker<T extends { id: number; name: string }>({
  anchorRect,
  items,
  label,
  renderMeta,
  onPick,
  onClose,
}: LinkPickerProps<T>) {
  const [query, setQuery] = useState('');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
    return pool.slice(0, 12);
  }, [items, query]);

  const left = Math.min(anchorRect.left, window.innerWidth - 320);
  const top = anchorRect.bottom + 4;

  return (
    <div ref={popRef} className="ac-pop" style={{ left, top }}>
      <div className="ac-head">{label}</div>
      <div style={{ padding: '4px 8px' }}>
        <input
          autoFocus
          className="ac-search"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <div className="ac-foot">No matches</div>
      ) : (
        filtered.map((it) => (
          <div key={it.id} className="ac-item" onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
            <span className="nm">{it.name}</span>
            <span className="ac-id">{renderMeta(it)}</span>
          </div>
        ))
      )}
      <div className="ac-foot">Click to match — removes NEW badge</div>
    </div>
  );
}

// ── name cell (matched link / two-line NEW editor) ──────────────────────────

function TaskNameCell({
  line,
  tasks,
  onName,
  onLink,
  onUnlink,
}: {
  line: ReportTaskLine;
  tasks: EntityPickerTask[];
  onName: (name: string) => void;
  onLink: (t: EntityPickerTask) => void;
  onUnlink: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);

  if (line.id != null) {
    return (
      <div className="matched-name">
        <Link className="name-chip" to={`/tasks/${line.id}`}>
          <span className="ent-ico chip-ico-task">
            <TaskIcon />
          </span>
          {line.task}
        </Link>
        <button className="unlink-btn" title="Mark as new — detach from the existing task" onClick={onUnlink}>
          mark&nbsp;new
        </button>
      </div>
    );
  }
  return (
    <div className="name-cell">
      <input
        className="cell-input name-input"
        value={line.task}
        placeholder="New task name…"
        onChange={(e) => onName(e.target.value)}
      />
      <div className="name-actions">
        <span className="new-badge">NEW</span>
        <button
          ref={btnRef}
          className="linkrow-btn"
          onClick={() => setPickerRect(btnRef.current?.getBoundingClientRect() ?? null)}
        >
          link existing…
        </button>
      </div>
      {pickerRect && (
        <LinkPicker
          anchorRect={pickerRect}
          items={tasks}
          label="Link to existing task"
          renderMeta={(t) => `#${t.id}`}
          onPick={(t) => { onLink(t); setPickerRect(null); }}
          onClose={() => setPickerRect(null)}
        />
      )}
    </div>
  );
}

function ArtifactNameCell({
  line,
  artifacts,
  onName,
  onLink,
  onUnlink,
}: {
  line: ReportArtifactLine;
  artifacts: EntityPickerArtifact[];
  onName: (name: string) => void;
  onLink: (a: EntityPickerArtifact) => void;
  onUnlink: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);

  if (line.id != null) {
    return (
      <div className="matched-name">
        <Link className="name-chip" to={`/artifacts/${line.id}`}>
          <span className="ent-ico chip-ico-artifact">
            <ArtifactIcon />
          </span>
          {line.artifact}
        </Link>
        <button className="unlink-btn" title="Mark as new — detach from the existing artifact" onClick={onUnlink}>
          mark&nbsp;new
        </button>
      </div>
    );
  }
  return (
    <div className="name-cell">
      <input
        className="cell-input name-input"
        value={line.artifact}
        placeholder="New artifact name…"
        onChange={(e) => onName(e.target.value)}
      />
      <div className="name-actions">
        <span className="new-badge">NEW</span>
        <button
          ref={btnRef}
          className="linkrow-btn"
          onClick={() => setPickerRect(btnRef.current?.getBoundingClientRect() ?? null)}
        >
          link existing…
        </button>
      </div>
      {pickerRect && (
        <LinkPicker
          anchorRect={pickerRect}
          items={artifacts}
          label="Link to existing artifact"
          renderMeta={(a) => `${a.type} #${a.id}`}
          onPick={(a) => { onLink(a); setPickerRect(null); }}
          onClose={() => setPickerRect(null)}
        />
      )}
    </div>
  );
}

// ── flat Tasks table ────────────────────────────────────────────────────────

function TasksCard({
  tasks,
  keys,
  entities,
  domains,
  onChange,
}: {
  tasks: ReportTaskLine[];
  keys: string[];
  entities: TeamEntities;
  domains: DomainOption[];
  onChange: (next: ReportTaskLine[], nextKeys: string[]) => void;
}) {
  function patch(i: number, p: Partial<ReportTaskLine>) {
    const next = tasks.map((t, idx) => (idx === i ? { ...t, ...p } : t));
    onChange(next, keys);
  }
  function linkExisting(i: number, t: EntityPickerTask) {
    patch(i, { id: t.id, task: t.name });
  }
  function unlink(i: number) {
    patch(i, { id: null });
  }
  function setDomain(i: number, picked: DomainOption | null) {
    patch(i, picked ? { domain_id: picked.id, domain: picked.name } : { domain_id: null, domain: null });
  }
  function del(i: number) {
    onChange(tasks.filter((_, idx) => idx !== i), keys.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange(
      [...tasks, { id: null, task: '', status: 'planned', domain_id: null, domain: null }],
      [...keys, nextKey()],
    );
  }

  return (
    <div className="card">
      <DomainLegend domains={domains} />
      <div className="card-head">
        <span className="card-title">
          Tasks <span className="count">{tasks.length}</span>
        </span>
      </div>
      <div className="card-body flush">
        <table className="flat">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Domain</th>
              <th>Finished on</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr key={keys[i]}>
                <td className="name-td">
                  <TaskNameCell
                    line={t}
                    tasks={entities.tasks}
                    onName={(name) => patch(i, { task: name })}
                    onLink={(ent) => linkExisting(i, ent)}
                    onUnlink={() => unlink(i)}
                  />
                </td>
                <td>
                  <StatusControl value={t.status} onChange={(s) => patch(i, { status: s })} />
                </td>
                <td>
                  <input
                    className="cell-input owner-input"
                    value={t.owner ?? ''}
                    placeholder="owner"
                    onChange={(e) => patch(i, { owner: e.target.value })}
                  />
                </td>
                <td>
                  <DomainSelect domain={t.domain} domains={domains} onChange={(d) => setDomain(i, d)} />
                </td>
                <td>
                  <input
                    className="cell-date"
                    type="date"
                    value={t.finished_on ?? ''}
                    onChange={(e) => patch(i, { finished_on: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input note-input"
                    value={t.note ?? ''}
                    placeholder="note"
                    onChange={(e) => patch(i, { note: e.target.value })}
                  />
                </td>
                <td>
                  <button className="del-btn" title="Remove row" onClick={() => del(i)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="add-row-btn" onClick={add}>
        + Add task
      </button>
    </div>
  );
}

// ── flat Artifacts table ────────────────────────────────────────────────────

function ArtifactsCard({
  artifacts,
  keys,
  entities,
  domains,
  onChange,
}: {
  artifacts: ReportArtifactLine[];
  keys: string[];
  entities: TeamEntities;
  domains: DomainOption[];
  onChange: (next: ReportArtifactLine[], nextKeys: string[]) => void;
}) {
  function patch(i: number, p: Partial<ReportArtifactLine>) {
    const next = artifacts.map((a, idx) => (idx === i ? { ...a, ...p } : a));
    onChange(next, keys);
  }
  // Replace a whole line (used to CLEAR optionals under exactOptionalPropertyTypes).
  function replace(i: number, fn: (a: ReportArtifactLine) => ReportArtifactLine) {
    onChange(artifacts.map((a, idx) => (idx === i ? fn(a) : a)), keys);
  }
  function setType(i: number, v: string) {
    replace(i, (a) => {
      const next = { ...a };
      if (v) next.type = v as ArtifactType;
      else delete next.type;
      return next;
    });
  }
  function setChangeKind(i: number, v: string) {
    replace(i, (a) => {
      const next = { ...a };
      if (v) next.change_kind = v as ArtifactChangeKind;
      else delete next.change_kind;
      return next;
    });
  }
  function linkExisting(i: number, a: EntityPickerArtifact) {
    patch(i, { id: a.id, artifact: a.name, type: a.type });
  }
  function unlink(i: number) {
    patch(i, { id: null });
  }
  function setDomain(i: number, picked: DomainOption | null) {
    patch(i, picked ? { domain_id: picked.id, domain: picked.name } : { domain_id: null, domain: null });
  }
  function del(i: number) {
    onChange(artifacts.filter((_, idx) => idx !== i), keys.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange(
      [...artifacts, { id: null, artifact: '', type: 'skill', change_kind: 'added', domain_id: null, domain: null }],
      [...keys, nextKey()],
    );
  }

  return (
    <div className="card">
      <DomainLegend domains={domains} />
      <div className="card-head">
        <span className="card-title">
          Artifacts <span className="count">{artifacts.length}</span>
        </span>
      </div>
      <div className="card-body flush">
        <table className="flat">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Tags</th>
              <th>Domain</th>
              <th>Change</th>
              <th>Summary</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {artifacts.map((a, i) => (
              <tr key={keys[i]}>
                <td className="name-td">
                  <ArtifactNameCell
                    line={a}
                    artifacts={entities.artifacts}
                    onName={(name) => patch(i, { artifact: name })}
                    onLink={(ent) => linkExisting(i, ent)}
                    onUnlink={() => unlink(i)}
                  />
                </td>
                <td>
                  <select
                    className="cell-select"
                    value={a.type ?? ''}
                    onChange={(e) => setType(i, e.target.value)}
                  >
                    <option value="">— type —</option>
                    {TYPE_OPTS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="cell-input tags-input"
                    value={(a.tags ?? []).join(', ')}
                    placeholder="tags"
                    onChange={(e) =>
                      patch(i, {
                        tags: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </td>
                <td>
                  <DomainSelect domain={a.domain} domains={domains} onChange={(d) => setDomain(i, d)} />
                </td>
                <td>
                  <select
                    className="cell-select"
                    value={a.change_kind ?? ''}
                    onChange={(e) => setChangeKind(i, e.target.value)}
                  >
                    <option value="">— change —</option>
                    {CHANGE_OPTS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="cell-input summary-input"
                    value={a.summary ?? ''}
                    placeholder="summary"
                    onChange={(e) => patch(i, { summary: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input note-input"
                    value={a.note ?? ''}
                    placeholder="note"
                    onChange={(e) => patch(i, { note: e.target.value })}
                  />
                </td>
                <td>
                  <button className="del-btn" title="Remove row" onClick={() => del(i)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="add-row-btn" onClick={add}>
        + Add artifact
      </button>
    </div>
  );
}

// ── rich mention editor (contenteditable; @/# triggers → icon-chips) ─────────
//
// The persisted string uses the prototype token encoding inside the free-text
// fields: `{{task:ID:Name}}` / `{{artifact:ID:Name}}`. ID may be a real PK
// (matched) or `null` (a NEW reference). The contenteditable renders tokens as
// chips; on serialization we walk the DOM back to tokens + plain text.

const TOKEN_RE = /\{\{(task|artifact):([^:}]+):([^}]+)\}\}/g;

/** Build contenteditable HTML from a token-encoded string. */
function tokensToHtml(str: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(str)) !== null) {
    out += escapeHtml(str.slice(last, m.index));
    const kind = m[1] as 'task' | 'artifact';
    const rawId = m[2];
    const name = m[3] ?? '';
    const id = rawId && rawId !== 'null' ? rawId : null;
    out += chipHtml(kind, id, name);
    last = m.index + m[0].length;
  }
  out += escapeHtml(str.slice(last));
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

const TASK_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8.2 7 10.2 11 5.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ART_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 2.2 13.6 5 8 7.8 2.4 5 8 2.2Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2.4 8 8 10.8 13.6 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.4 11 8 13.8 13.6 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A chip is rendered as a `<span contenteditable=false>` carrying its token in
 *  data attributes. Editing the chip's visible text away unlinks it (handled at
 *  serialization: a chip whose text != stored name becomes plain text). */
function chipHtml(kind: 'task' | 'artifact', id: string | null, name: string): string {
  const icon = kind === 'task' ? TASK_ICON_SVG : ART_ICON_SVG;
  const cls = kind === 'task' ? 'chip-task' : 'chip-artifact';
  return (
    `<span class="ref-chip ${cls}" contenteditable="false" data-kind="${kind}" ` +
    `data-id="${id ?? 'null'}" data-name="${escapeHtml(name)}">` +
    `<span class="ent-ico">${icon}</span>${escapeHtml(name)}</span>`
  );
}

/** Walk a contenteditable element back to a token-encoded string. */
function htmlToTokens(root: HTMLElement): string {
  let out = '';
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof HTMLElement) {
      if (node.classList.contains('ref-chip')) {
        const kind = node.getAttribute('data-kind') as 'task' | 'artifact';
        const idAttr = node.getAttribute('data-id');
        const storedName = node.getAttribute('data-name') ?? '';
        const visible = (node.textContent ?? '').trim();
        // Editing the chip text away unlinks it → plain text.
        if (visible && visible !== storedName) {
          out += visible;
        } else {
          const id = idAttr && idAttr !== 'null' ? idAttr : 'null';
          out += `{{${kind}:${id}:${storedName}}}`;
        }
      } else if (node.tagName === 'BR') {
        out += '\n';
      } else {
        out += node.textContent ?? '';
      }
    }
  });
  return out;
}

interface AcState {
  kind: 'task' | 'artifact';
  query: string;
  left: number;
  top: number;
  textNode: Text;
  matchStart: number; // offset of the trigger char in textNode
}

function RichMentionEditor({
  value,
  onChange,
  entities,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  entities: TeamEntities;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ac, setAc] = useState<AcState | null>(null);
  const [acActive, setAcActive] = useState(0);
  // Only re-seed innerHTML when `value` changes from OUTSIDE (not our own edits).
  const lastEmitted = useRef(value);

  useLayoutEffect(() => {
    if (ref.current && value !== lastEmitted.current) {
      ref.current.innerHTML = tokensToHtml(value);
      lastEmitted.current = value;
    }
  }, [value]);

  // Initial mount seed.
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = tokensToHtml(value);
      lastEmitted.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = useCallback(() => {
    if (!ref.current) return;
    const tokens = htmlToTokens(ref.current);
    lastEmitted.current = tokens;
    onChange(tokens);
  }, [onChange]);

  const candidates = useMemo(() => {
    if (!ac) return [] as { id: number; name: string; type?: string }[];
    const pool = ac.kind === 'task' ? entities.tasks : entities.artifacts;
    const q = ac.query.trim().toLowerCase();
    return (q ? pool.filter((p) => p.name.toLowerCase().includes(q)) : pool).slice(0, 8);
  }, [ac, entities]);

  function detectTrigger() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return setAc(null);
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return setAc(null);
    const textNode = node as Text;
    const text = (textNode.textContent ?? '').slice(0, range.startOffset);
    const m = /([@#])([\w\- ]*)$/.exec(text);
    if (!m) return setAc(null);
    const kind = m[1] === '@' ? 'task' : 'artifact';
    const matchStart = range.startOffset - m[0].length;
    let left = 80;
    let top = 120;
    try {
      const r = document.createRange();
      r.setStart(textNode, Math.min(range.startOffset, textNode.length));
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      if (rect.left || rect.top) {
        left = Math.min(rect.left, window.innerWidth - 320);
        top = rect.bottom + 4;
      }
    } catch {
      // fall back to defaults
    }
    setAc({ kind, query: m[2] ?? '', left, top, textNode, matchStart });
    setAcActive(0);
  }

  function pick(item: { id: number; name: string }) {
    if (!ac || !ref.current) return;
    const { textNode, matchStart } = ac;
    const full = textNode.textContent ?? '';
    const before = full.slice(0, matchStart);
    const after = full.slice(matchStart + 1 + ac.query.length);
    // Build chip element.
    const tmp = document.createElement('div');
    tmp.innerHTML = chipHtml(ac.kind, String(item.id), item.name);
    const chip = tmp.firstChild as HTMLElement;
    const parent = textNode.parentNode;
    if (!parent) return;
    const afterNode = document.createTextNode(' ' + after);
    const beforeNode = document.createTextNode(before);
    parent.replaceChild(afterNode, textNode);
    parent.insertBefore(chip, afterNode);
    parent.insertBefore(beforeNode, chip);
    // Place caret just after the chip.
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.setStart(afterNode, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    setAc(null);
    emit();
    ref.current.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!ac || candidates.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAcActive((i) => Math.min(i + 1, candidates.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAcActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const c = candidates[acActive];
      if (c) pick(c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAc(null);
    }
  }

  return (
    <div className="rte-wrap">
      <div
        ref={ref}
        className="rte"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ''}
        onInput={() => {
          emit();
          detectTrigger();
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setAc(null), 160)}
      />
      {ac && candidates.length > 0 && (
        <div className="ac-pop" style={{ left: ac.left, top: ac.top }}>
          <div className="ac-head">{ac.kind === 'task' ? 'Tasks (@ trigger)' : 'Artifacts (# trigger)'}</div>
          {candidates.map((c, i) => (
            <div
              key={c.id}
              className={`ac-item${i === acActive ? ' ac-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="nm">{c.name}</span>
              <span className="ac-id">#{c.id}</span>
            </div>
          ))}
          <div className="ac-foot">↑↓ navigate, Enter pick, Esc dismiss</div>
        </div>
      )}
    </div>
  );
}

// ── Action items table ──────────────────────────────────────────────────────

function ActionItemsCard({
  items,
  keys,
  entities,
  domains,
  onChange,
}: {
  items: ReportActionItemLine[];
  keys: string[];
  entities: TeamEntities;
  domains: DomainOption[];
  onChange: (next: ReportActionItemLine[], nextKeys: string[]) => void;
}) {
  function patch(i: number, p: Partial<ReportActionItemLine>) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)), keys);
  }
  function setDomain(i: number, picked: DomainOption | null) {
    patch(i, picked ? { domain_id: picked.id, domain: picked.name } : { domain_id: null, domain: null });
  }
  function del(i: number) {
    onChange(items.filter((_, idx) => idx !== i), keys.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, { text: '', domain_id: null, domain: null }], [...keys, nextKey()]);
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          Action items <span className="count">{items.length}</span>
        </span>
      </div>
      <div className="card-body flush">
        <table className="ai-table">
          <thead>
            <tr>
              <th>Action item (type @ task or # artifact)</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Domain</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={keys[i]}>
                <td className="ai-text-td">
                  <RichMentionEditor
                    value={it.text}
                    onChange={(v) => patch(i, { text: v })}
                    entities={entities}
                    placeholder="Action item…"
                  />
                </td>
                <td>
                  <input
                    className="cell-input owner-input"
                    value={it.owner ?? ''}
                    placeholder="owner"
                    onChange={(e) => patch(i, { owner: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-date"
                    type="date"
                    value={it.due_date ?? ''}
                    onChange={(e) => patch(i, { due_date: e.target.value })}
                  />
                </td>
                <td>
                  <DomainSelect domain={it.domain} domains={domains} onChange={(d) => setDomain(i, d)} />
                </td>
                <td>
                  <button className="del-btn" title="Remove row" onClick={() => del(i)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="add-row-btn" onClick={add}>
        + Add action item
      </button>
      <div className="hint-line">
        Type <strong>@</strong> for a task reference, <strong>#</strong> for an artifact — picks insert a subtle
        icon-chip, not the raw character.
      </div>
    </div>
  );
}

// ── Discussion / Issues note lists ──────────────────────────────────────────

interface NoteRow {
  key: string;
  text: string;
}

/** Self-contained list of @/#-aware note items. Owns its rows (incl. empty,
 *  in-progress ones) so list identity never depends on the joined string;
 *  reports the joined string (or null) up on every change. Seeded once from the
 *  initial joined string. */
function NoteListCard({
  title,
  initial,
  entities,
  addLabel,
  onChange,
}: {
  title: string;
  initial: string | null | undefined;
  entities: TeamEntities;
  addLabel: string;
  onChange: (joined: string | null) => void;
}) {
  const [rows, setRows] = useState<NoteRow[]>(() =>
    splitNotes(initial).map((text) => ({ key: nextKey(), text })),
  );

  function commit(next: NoteRow[]) {
    setRows(next);
    onChange(joinNotes(next.map((r) => r.text)));
  }
  function patch(i: number, v: string) {
    commit(rows.map((r, idx) => (idx === i ? { ...r, text: v } : r)));
  }
  function del(i: number) {
    commit(rows.filter((_, idx) => idx !== i));
  }
  function add() {
    commit([...rows, { key: nextKey(), text: '' }]);
  }

  return (
    <div className="card">
      <div className="card-head">
        <span className="card-title">
          {title} <span className="count">{rows.length}</span>
        </span>
      </div>
      <div className="card-body">
        <div className="note-list">
          {rows.map((row, i) => (
            <div className="note-item" key={row.key}>
              <span className="bullet" />
              <div className="note-rte-host">
                <RichMentionEditor
                  value={row.text}
                  onChange={(v) => patch(i, v)}
                  entities={entities}
                  placeholder="…"
                />
              </div>
              <button className="del-btn" title="Remove item" onClick={() => del(i)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <button className="add-row-btn add-row-inline" onClick={add}>
          {addLabel}
        </button>
        <div className="hint-line">
          Type <strong>@</strong> for a task, <strong>#</strong> for an artifact — inserts a linked icon-chip
          mid-text.
        </div>
      </div>
    </div>
  );
}

// ── stable key generator ────────────────────────────────────────────────────

let _keyCtr = 0;
export function nextKey(): string {
  return String(++_keyCtr);
}

// ── string <-> list helpers for discussion / issues ─────────────────────────

/** Split a stored discussion/issues string into list items (one per line). */
export function splitNotes(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split('\n').map((x) => x.trimEnd()).filter((x) => x.length > 0);
}
/** Join list items back into the single stored string (null when empty). */
function joinNotes(items: string[]): string | null {
  const kept = items.map((x) => x.trim()).filter(Boolean);
  return kept.length > 0 ? kept.join('\n') : null;
}

// ── editor state container — keys live alongside data ───────────────────────

export interface EditorKeys {
  tasks: string[];
  artifacts: string[];
  actionItems: string[];
}

/** Seed stable keys for an initial report (one per table row). Discussion /
 *  issues manage their own row identity internally (NoteListCard). */
export function makeKeys(report: ReportJson): EditorKeys {
  return {
    tasks: (report.tasks ?? []).map(() => nextKey()),
    artifacts: (report.artifacts ?? []).map(() => nextKey()),
    actionItems: (report.action_items ?? []).map(() => nextKey()),
  };
}

// ── save-time sanitizer (backend extra="forbid") ────────────────────────────
//
// Produce a `ReportJson` carrying ONLY backend keys. Strips empty optionals and
// — critically — never leaks UI-only state. Domain pairs are kept together;
// `id` is normalized (NEW → null). Discussion/issues stay plain strings.

export function stripReportForSave(report: ReportJson): ReportJson {
  const out: ReportJson = {
    champion: report.champion,
    meeting_date: report.meeting_date,
    raw_notes: report.raw_notes,
  };
  if (report.participants && report.participants.length > 0) out.participants = report.participants;

  out.tasks = (report.tasks ?? []).map((t) => {
    const line: ReportTaskLine = { task: t.task, status: t.status };
    if (t.id != null) line.id = t.id;
    if (t.owner) line.owner = t.owner;
    if (t.note) line.note = t.note;
    if (t.finished_on) line.finished_on = t.finished_on;
    if (t.domain_id != null) {
      line.domain_id = t.domain_id;
      if (t.domain) line.domain = t.domain;
    }
    return line;
  });

  out.artifacts = (report.artifacts ?? []).map((a) => {
    const line: ReportArtifactLine = { artifact: a.artifact };
    if (a.id != null) line.id = a.id;
    if (a.type) line.type = a.type;
    if (a.tags && a.tags.length > 0) line.tags = a.tags;
    if (a.summary) line.summary = a.summary;
    if (a.change_kind) line.change_kind = a.change_kind;
    if (a.note) line.note = a.note;
    if (a.domain_id != null) {
      line.domain_id = a.domain_id;
      if (a.domain) line.domain = a.domain;
    }
    return line;
  });

  out.action_items = (report.action_items ?? []).map((it) => {
    const line: ReportActionItemLine = { text: it.text };
    if (it.owner) line.owner = it.owner;
    if (it.due_date) line.due_date = it.due_date;
    if (it.domain_id != null) {
      line.domain_id = it.domain_id;
      if (it.domain) line.domain = it.domain;
    }
    return line;
  });

  if (report.discussion) out.discussion = report.discussion;
  if (report.issues) out.issues = report.issues;
  return out;
}

/** NEW artifacts (id null) MUST carry a type. Returns the offending names. */
export function findMissingArtifactTypes(report: ReportJson): string[] {
  return (report.artifacts ?? [])
    .filter((a) => a.id == null && !a.type)
    .map((a) => a.artifact || '(unnamed artifact)');
}

// ── the full editor body ────────────────────────────────────────────────────

export function FlatReportEditor({
  report,
  keys,
  entities,
  domains,
  onReportChange,
  onKeysChange,
}: {
  report: ReportJson;
  keys: EditorKeys;
  entities: TeamEntities;
  domains: DomainOption[];
  onReportChange: (next: ReportJson) => void;
  onKeysChange: (next: EditorKeys) => void;
}) {
  return (
    <div className="report-editor">
      {/* Report header card */}
      <div className="report-head">
        <div className="team-eyebrow">Report editor</div>
        <h1 className="report-head-h1">Report — champion {report.champion}</h1>
        <div className="head-row">
          <div className="meta-field">
            <label>Meeting date</label>
            <input
              className="meta-input"
              type="date"
              value={report.meeting_date}
              onChange={(e) => onReportChange({ ...report, meeting_date: e.target.value })}
            />
          </div>
          <div className="meta-field">
            <label>Champion</label>
            <span className="meta-static">{report.champion}</span>
          </div>
        </div>
        <div className="participants-row">
          <span className="participants-label">Participants:</span>
          {(report.participants ?? []).map((p) => (
            <span className="avatar" key={p}>
              <span className="dot">{p.slice(0, 1).toUpperCase()}</span>
              {p}
            </span>
          ))}
          <input
            className="participants-edit"
            value={(report.participants ?? []).join(', ')}
            placeholder="Comma-separated names"
            onChange={(e) => {
              const parts = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
              const next = { ...report };
              if (parts.length > 0) next.participants = parts;
              else delete next.participants;
              onReportChange(next);
            }}
          />
        </div>
      </div>

      <TasksCard
        tasks={report.tasks ?? []}
        keys={keys.tasks}
        entities={entities}
        domains={domains}
        onChange={(tasks, nextKeys) => {
          onReportChange({ ...report, tasks });
          onKeysChange({ ...keys, tasks: nextKeys });
        }}
      />

      <ArtifactsCard
        artifacts={report.artifacts ?? []}
        keys={keys.artifacts}
        entities={entities}
        domains={domains}
        onChange={(artifacts, nextKeys) => {
          onReportChange({ ...report, artifacts });
          onKeysChange({ ...keys, artifacts: nextKeys });
        }}
      />

      <ActionItemsCard
        items={report.action_items ?? []}
        keys={keys.actionItems}
        entities={entities}
        domains={domains}
        onChange={(action_items, nextKeys) => {
          onReportChange({ ...report, action_items });
          onKeysChange({ ...keys, actionItems: nextKeys });
        }}
      />

      <NoteListCard
        title="Discussion"
        initial={report.discussion}
        entities={entities}
        addLabel="+ Add point"
        onChange={(joined) => onReportChange({ ...report, discussion: joined })}
      />

      <NoteListCard
        title="Issues"
        initial={report.issues}
        entities={entities}
        addLabel="+ Add issue"
        onChange={(joined) => onReportChange({ ...report, issues: joined })}
      />
    </div>
  );
}
