import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '@/api';
import type { Domain, Task, TaskDetail } from '@/types';
import { StatusBadge } from '@/components/Badge';

// Route: "/tasks/:id" — full task detail page (link target for matched-entity
// chips in the report editor). Mirrors the approved prototype's detail "page":
//   - a hero with the task name + a facts row,
//   - status is READ-ONLY (report-derived) with a note pointing at the report,
//   - a contextual Edit button that toggles editing of the EDITABLE fields only
//     (owner + domain), saved via PATCH /api/tasks/{id},
//   - a history timeline using DATES ONLY (meeting_date + status + change_note).

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const taskId = Number(id);

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Domain options for the team this task belongs to (resolved via its domain).
  const [domains, setDomains] = useState<Domain[]>([]);

  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    if (!Number.isFinite(taskId)) {
      setError('Invalid task id.');
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
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load task');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  function handleSaved(updated: Task) {
    setDetail((prev) => {
      if (!prev) return prev;
      const newDomain = domains.find((d) => d.id === updated.domain_id);
      return { ...prev, task: updated, domain: newDomain ? newDomain.name : prev.domain };
    });
    setEditing(false);
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
          <div className="warning-banner">{error ?? 'Task not found.'}</div>
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
              {!editing && (
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
                onSaved={handleSaved}
              />
            ) : (
              <div className="case-header-meta" style={{ borderTop: '1px solid #f1f2f4', paddingTop: 16 }}>
                <div className="case-meta-item">
                  <div className="case-meta-label">Status</div>
                  <div className="case-meta-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="text-muted text-sm" style={{ marginTop: 4, maxWidth: 220 }}>
                    Status &amp; dates come from reports — edit the source report.
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
                  <div className="case-meta-label">Ended</div>
                  <div className="case-meta-value">
                    {task.ended_on || <span className="text-muted">—</span>}
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
                        <Link
                          to={`/reports/${h.report_id}/edit`}
                          className="btn btn-sm btn-outline"
                          style={{ fontSize: 11, padding: '1px 7px' }}
                          title="Edit the report that recorded this entry"
                        >
                          Edit report
                        </Link>
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

// ── Edit form — EDITABLE fields only: owner (text) + domain (dropdown) ───────

interface TaskEditFormProps {
  task: Task;
  domains: Domain[];
  onCancel: () => void;
  onSaved: (updated: Task) => void;
}

function TaskEditForm({ task, domains, onCancel, onSaved }: TaskEditFormProps) {
  const [owner, setOwner] = useState(task.owner ?? '');
  const [domainId, setDomainId] = useState<number>(task.domain_id);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    // Send ONLY the editable fields, and only when changed (task never sends
    // status/started_on/ended_on — the backend 422s on those).
    const body: { owner?: string | null; domain_id?: number } = {};
    const trimmed = owner.trim();
    if (trimmed !== (task.owner ?? '')) body.owner = trimmed === '' ? null : trimmed;
    if (domainId !== task.domain_id) body.domain_id = domainId;

    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }

    try {
      const updated = await api.views.patchTask(task.id, body);
      onSaved(updated);
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
      <div className="text-muted text-sm" style={{ marginBottom: 12 }}>
        Status, started &amp; ended dates are report-derived and edited in the source report.
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
