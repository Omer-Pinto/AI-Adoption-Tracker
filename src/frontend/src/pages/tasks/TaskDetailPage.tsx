import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '@/api';
import type { Domain, TaskDetail, TaskHistoryEntry, TaskPatchBody, TaskStatus } from '@/types';
import { StatusBadge } from '@/components/Badge';
import { ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';

// A subtle, calm marker showing whether a history entry came from a report or a
// manual current-state edit. Report entries stay unlabeled (the common case);
// manual edits get a muted "manual" tag so "was this a meeting update or a
// manual fix?" is answerable at a glance — no loud color.
function HistorySourceTag({ source }: { source: TaskHistoryEntry['source'] }) {
  if (source !== 'manual') return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: '#6b7280',
        background: '#f1f2f4',
        borderRadius: 4,
        padding: '1px 6px',
      }}
      title="Recorded by a manual edit (not from a report)"
    >
      manual
    </span>
  );
}

// Route: "/tasks/:id" — full task detail page (link target for matched-entity
// chips in the report editor). This is a MANAGER current-state edit interface:
//   - a hero with the task name + a facts row,
//   - a contextual Edit button toggling editing of status / owner / domain /
//     started_on / ended_on, saved via PATCH /api/tasks/{id} (un-journaled),
//   - a history timeline using DATES ONLY (meeting_date + status + change_note).

// Editable status options (authoritative enum order from models.py).
const STATUS_OPTS: { v: TaskStatus; l: string }[] = [
  { v: 'planned', l: 'Planned' },
  { v: 'in-progress', l: 'In progress' },
  { v: 'finished_successfully', l: 'Finished successfully' },
  { v: 'finished_with_issues', l: 'Finished with issues' },
  { v: 'blocked', l: 'Blocked' },
  { v: 'abandoned', l: 'Abandoned' },
  { v: 'wont_fix', l: "Won't Fix" },
];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const taskId = Number(id);

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // 'invalid' = bad id (not found), 'error' = genuine load failure, null = ok.
  const [error, setError] = useState<'invalid' | 'error' | null>(null);

  // Domain options for the team this task belongs to (resolved via its domain).
  const [domains, setDomains] = useState<Domain[]>([]);

  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    if (!Number.isFinite(taskId)) {
      setError('invalid');
      setLoading(false);
      return;
    }
    api.views
      .task(taskId)
      .then(async (d) => {
        if (cancelled) return;
        setDetail(d);
        setLoading(false);
        // Resolve the task's team via its domain, then load that team's domains
        // for the edit picker. The task carries domain_id but not team_id, so we
        // read the full domain list and match the current domain to its team.
        try {
          const all = await api.domains.list();
          if (cancelled) return;
          const own = all.find((dm) => dm.id === d.task.domain_id);
          if (own) {
            setDomains(all.filter((dm) => dm.team_id === own.team_id));
          } else {
            setDomains(all);
          }
        } catch {
          // Non-fatal: the page still renders; the picker just stays empty.
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        // A removed/unknown id comes back as a 404 → show the friendly
        // "not found" state, not the generic load-failure one.
        setError(e instanceof ApiError && e.status === 404 ? 'invalid' : 'error');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => load(), [load]);

  // After a successful PATCH, re-read the authoritative detail from the backend
  // (it resolves the domain NAME server-side) rather than guessing the name from
  // a local domains list that may have failed to load. Keeps the header label
  // in sync with the saved domain.
  async function handleSaved() {
    setEditing(false);
    try {
      const fresh = await api.views.task(taskId);
      setDetail(fresh);
    } catch {
      // Non-fatal: the save succeeded; a transient refetch failure just leaves
      // the prior detail on screen.
    }
  }

  if (loading) {
    return (
      <div className="page-body">
        <div className="text-muted text-sm">Loading task…</div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <>
        <div className="top-bar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            ← Back
          </button>
        </div>
        <div className="page-body">
          <div className="panel">
            {error === 'invalid' || (!detail && !error) ? (
              <ErrorState
                title="Task not found"
                hint="This task may have been removed or the link is no longer valid."
              />
            ) : (
              <ErrorState
                title="Couldn't load this task"
                hint="The task failed to load. Try again."
                onRetry={load}
              />
            )}
          </div>
        </div>
      </>
    );
  }

  const { task, domain, history } = detail;

  return (
    <>
      <div className="top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <span className="top-bar-sub">Task #{task.id}</span>
        </div>
        <div className="top-bar-actions">
          <Link to="/tasks" className="btn btn-outline btn-sm">
            All tasks
          </Link>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 860 }}>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-body-padded">
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div>
                <div className="detail-eyebrow">Task</div>
                <h2 className="detail-title">{task.name}</h2>
              </div>
              {isAdmin && !editing && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setEditing(true)}
                >
                  Edit details
                </button>
              )}
            </div>

            {editing ? (
              <TaskEditForm
                task={task}
                domains={domains}
                onCancel={() => setEditing(false)}
                onSaved={() => void handleSaved()}
              />
            ) : (
              <div className="case-header-meta" style={{ borderTop: '1px solid #f1f2f4', paddingTop: 16 }}>
                <div className="case-meta-item">
                  <div className="case-meta-label">Status</div>
                  <div className="case-meta-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={task.status} />
                  </div>
                </div>
                <div className="case-meta-item">
                  <div className="case-meta-label">Owner</div>
                  <div className="case-meta-value">
                    {task.owner || <span className="text-muted">—</span>}
                  </div>
                </div>
                <div className="case-meta-item">
                  <div className="case-meta-label">Domain</div>
                  <div className="case-meta-value">
                    {domain || <span className="text-muted">General</span>}
                  </div>
                </div>
                <div className="case-meta-item">
                  <div className="case-meta-label">Started</div>
                  <div className="case-meta-value">
                    {task.started_on || <span className="text-muted">—</span>}
                  </div>
                </div>
                <div className="case-meta-item">
                  <div className="case-meta-label">Due on</div>
                  <div className="case-meta-value">
                    {task.due_date || <span className="text-muted">—</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── History timeline (dates only) ────────────────────────────── */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">History</span>
          </div>
          <div className="panel-body-padded">
            {history.length === 0 ? (
              <div className="text-muted text-sm">No history recorded yet.</div>
            ) : (
              <div className="detail-timeline">
                {history.map((h) => (
                  <div className="detail-tl-row" key={h.id}>
                    <span className={`detail-tl-dot dot-${h.status_at_meeting}`} />
                    <div className="detail-tl-content">
                      <div className="detail-tl-head">
                        <span className="detail-tl-date">{h.meeting_date}</span>
                        <StatusBadge status={h.status_at_meeting} />
                        <HistorySourceTag source={h.source} />
                        {isAdmin && h.report_id != null && (
                          <Link
                            to={`/reports/${h.report_id}/edit`}
                            className="btn btn-sm btn-outline"
                            style={{ fontSize: 11, padding: '1px 7px' }}
                            title="Edit the report that recorded this entry"
                          >
                            Edit report
                          </Link>
                        )}
                      </div>
                      {h.change_note && <div className="detail-tl-text">{h.change_note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Edit form — manager current-state edit: status, owner, domain, dates ─────

interface TaskEditFormProps {
  task: TaskDetail['task'];
  domains: Domain[];
  onCancel: () => void;
  onSaved: () => void;
}

function TaskEditForm({ task, domains, onCancel, onSaved }: TaskEditFormProps) {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [owner, setOwner] = useState(task.owner ?? '');
  const [domainId, setDomainId] = useState<number>(task.domain_id);
  const [startedOn, setStartedOn] = useState(task.started_on ?? '');
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    // Send ONLY the CHANGED fields among {status, owner, domain_id,
    // started_on, due_date} — the backend accepts all five (un-journaled).
    const body: TaskPatchBody = {};
    if (status !== task.status) body.status = status;
    const trimmed = owner.trim();
    if (trimmed !== (task.owner ?? '')) body.owner = trimmed === '' ? null : trimmed;
    if (domainId !== task.domain_id) body.domain_id = domainId;
    if (startedOn !== (task.started_on ?? '')) body.started_on = startedOn === '' ? null : startedOn;
    if (dueDate !== (task.due_date ?? '')) body.due_date = dueDate === '' ? null : dueDate;

    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }

    try {
      await api.views.patchTask(task.id, body);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.status === 404 ? 'Task not found (404).' : e.message);
      } else {
        setErr(e instanceof Error ? e.message : 'Failed to save.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ borderTop: '1px solid #f1f2f4', paddingTop: 16 }}>
      {err && (
        <div className="warning-banner" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Status</label>
        <select
          className="form-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
        >
          {STATUS_OPTS.map((s) => (
            <option key={s.v} value={s.v}>
              {s.l}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Owner</label>
        <input
          className="form-input"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          placeholder="Owner (leave blank to clear)"
        />
      </div>
      <div className="form-row">
        <label className="form-label">Domain</label>
        <select
          className="form-select"
          value={domainId}
          onChange={(e) => setDomainId(Number(e.target.value))}
        >
          {/* A task must stay placed — no null option (backend 422s on null). */}
          {domains.length === 0 && (
            <option value={task.domain_id}>{`Domain #${task.domain_id}`}</option>
          )}
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Started</label>
        <input
          className="form-input"
          type="date"
          value={startedOn}
          onChange={(e) => setStartedOn(e.target.value)}
        />
      </div>
      <div className="form-row">
        <label className="form-label">Due on</label>
        <input
          className="form-input"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
      <div className="text-muted text-sm" style={{ marginBottom: 12 }}>
        Manual edits are recorded in the history below (marked “manual”).
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
