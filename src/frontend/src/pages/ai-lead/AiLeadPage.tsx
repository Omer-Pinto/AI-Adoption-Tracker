import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '@/api';
import type {
  ActionItemPatchBody,
  AILeadActionItem,
  AILeadItem,
  AILeadItemCategory,
  TaskStatus,
  TeamPageIndexEntry,
} from '@/types';
import './ai-lead-page.css';

// Route: "/ai-lead" — the AI Lead's personal cross-team board. Tabbed (Variant B
// of prototype/ai-lead-board-redesign.html): an "Action items" tab (every item
// owned by the literal 'AI Lead' — both report-derived AND self-managed
// standalone items) and a "My toolkit" tab. This is NOT a team page.

type View = 'priority' | 'team';
type Tab = 'actions' | 'toolkit';

// Inline action-item form (shared by add + edit). `id` null = adding a new
// standalone item; a number = editing that item. A1+A2: ALL items (report-derived
// AND standalone) are fully editable here.
type ActionForm = {
  id: number | null;
  text: string;
  status: TaskStatus;
  due_date: string; // '' = no due date
  note: string; // '' = no note
  team_id: number | null; // null = the "General" gutter (no team)
};

const STATUS_OPTIONS: ReadonlyArray<readonly [TaskStatus, string]> = [
  ['planned', 'Planned'],
  ['in-progress', 'In progress'],
  ['blocked', 'Blocked'],
  ['finished_with_issues', 'Finished (issues)'],
  ['finished_successfully', 'Finished'],
  ['abandoned', 'Abandoned'],
  ['wont_fix', "Won't fix"],
];

// rank → lower sorts first (most actionable at the top)
const RANK: Record<TaskStatus, number> = {
  blocked: 0,
  'in-progress': 1,
  planned: 2,
  finished_with_issues: 3,
  finished_successfully: 4,
  abandoned: 5,
  wont_fix: 6,
};

const CLOSED = new Set<TaskStatus>([
  'finished_successfully',
  'finished_with_issues',
  'abandoned',
  'wont_fix',
]);

const TODAY = new Date().toISOString().slice(0, 10);

function isClosed(s: TaskStatus): boolean {
  return CLOSED.has(s);
}

// Overdue = a real due_date exists, is in the past, and the item is still open.
// (Per the frozen contract overdue keys off due_date, NOT meeting_date; a closed
// item is never flagged.)
function isOverdue(it: AILeadActionItem): boolean {
  return !!it.due_date && it.due_date < TODAY && !isClosed(it.status);
}

// A standalone (self-managed) item carries no report; a report-derived item was
// folded from a champion report. A1+A2: BOTH are fully editable + deletable — this
// flag now only drives the display label / team cell, not edit permissions.
function isStandalone(it: AILeadActionItem): boolean {
  return it.report_id === null;
}

// Stable per-team dot color (real team names are arbitrary; the mock hard-codes a
// palette). Hash the name into a fixed palette so each team keeps one color.
const TEAM_PALETTE = [
  '#3b82f6', '#8b5cf6', '#16a34a', '#d97706',
  '#ec4899', '#0891b2', '#ca8a04', '#dc2626',
];
function teamColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEAM_PALETTE[h % TEAM_PALETTE.length] ?? '#94a3b8';
}

export default function AiLeadPage() {
  const [items, setItems] = useState<AILeadActionItem[]>([]);
  // Teams for the add/edit team dropdown (options: "General" + every team).
  const [teams, setTeams] = useState<TeamPageIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('actions');
  const [view, setView] = useState<View>('priority');
  // Per-row inline save errors (keyed by item id), set on a failed PATCH/DELETE.
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  // Inline add/edit form (null when closed) + its save state.
  const [actionForm, setActionForm] = useState<ActionForm | null>(null);
  const [actionSaving, setActionSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Toolkit count surfaced into its tab badge (the Toolkit owns its own data).
  const [toolkitCount, setToolkitCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.aiLead
      .actionItems()
      .then((data) => {
        if (!cancelled) {
          setItems(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          // Calm, fixed message — never surface a raw "ApiError: GET … → 500".
          setError("Couldn't load action items.");
          setLoading(false);
        }
      });
    // Teams for the dropdown — best-effort; a failure just leaves it "General"-only.
    api.views
      .teamsIndex()
      .then((data) => { if (!cancelled) setTeams(data); })
      .catch(() => { /* dropdown degrades to General-only */ });
    return () => { cancelled = true; };
  }, []);

  // Resolve a team_id to its name for local reconciliation (null → General).
  function teamNameFor(teamId: number | null): string | null {
    if (teamId == null) return null;
    return teams.find((t) => t.team_id === teamId)?.team_name ?? null;
  }

  // Persisted inline edit (status / due_date): optimistically apply the patch,
  // PATCH the backend, then reconcile the row from the returned bare ActionItem.
  // Roll back + surface an inline error on failure.
  function patchItem(id: number, patch: ActionItemPatchBody) {
    const prev = items.find((it) => it.id === id);
    if (!prev) return;
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    clearRowError(id);
    api.aiLead
      .patch(id, patch)
      .then((updated) => {
        setItems((list) =>
          list.map((it) =>
            it.id === id
              ? { ...it, status: updated.status ?? it.status, due_date: updated.due_date, text: updated.text, note: updated.note }
              : it,
          ),
        );
      })
      .catch(() => {
        setItems((list) => list.map((it) => (it.id === id ? prev : it)));
        setRowErrors((e) => ({ ...e, [id]: "Couldn't save — try again." }));
      });
  }

  function clearRowError(id: number) {
    setRowErrors((e) => {
      if (!(id in e)) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
  }

  // ---- standalone add / edit / delete ----

  function openAdd() {
    setActionError(null);
    setTab('actions');
    // Default team = null (the "General" gutter).
    setActionForm({ id: null, text: '', status: 'planned', due_date: '', note: '', team_id: null });
  }

  function openEdit(it: AILeadActionItem) {
    setActionError(null);
    setActionForm({
      id: it.id,
      text: it.text,
      status: it.status,
      due_date: it.due_date ?? '',
      note: it.note ?? '',
      team_id: it.team_id,
    });
  }

  function closeForm() {
    setActionForm(null);
    setActionError(null);
  }

  function saveAction() {
    if (!actionForm) return;
    const text = actionForm.text.trim();
    if (!text) return; // Save is disabled, but guard anyway.
    setActionSaving(true);
    setActionError(null);
    const due = actionForm.due_date || null;
    const note = actionForm.note.trim() || null;
    const teamId = actionForm.team_id;
    if (actionForm.id === null) {
      api.aiLead
        .create({ text, status: actionForm.status, due_date: due, note, team_id: teamId })
        .then((created) => {
          setItems((list) => [...list, created]); // enriched row — append directly.
          setActionSaving(false);
          setActionForm(null);
        })
        .catch(() => {
          setActionSaving(false);
          setActionError("Couldn't save — try again.");
        });
    } else {
      const id = actionForm.id;
      api.aiLead
        .patch(id, { text, status: actionForm.status, due_date: due, note, team_id: teamId })
        .then((updated) => {
          // Reconcile from the returned bare ActionItem; derive team_name from
          // the returned team_id via the loaded teams list (null → General).
          setItems((list) =>
            list.map((it) =>
              it.id === id
                ? {
                    ...it,
                    text: updated.text,
                    status: updated.status ?? it.status,
                    due_date: updated.due_date,
                    note: updated.note,
                    team_id: updated.team_id,
                    team_name: teamNameFor(updated.team_id),
                  }
                : it,
            ),
          );
          setActionSaving(false);
          setActionForm(null);
        })
        .catch(() => {
          setActionSaving(false);
          setActionError("Couldn't save — try again.");
        });
    }
  }

  function deleteAction(it: AILeadActionItem) {
    if (!confirm(`Delete this action item?\n\n"${it.text}"`)) return;
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== it.id));
    setActionForm((f) => (f && f.id === it.id ? null : f));
    api.aiLead
      .delete(it.id)
      .catch(() => {
        setItems(prev); // roll back
        setRowErrors((e) => ({ ...e, [it.id]: "Couldn't delete — try again." }));
      });
  }

  const counts = useMemo(() => {
    const open = items.filter((it) => !isClosed(it.status)).length;
    const overdue = items.filter(isOverdue).length;
    const blocked = items.filter((it) => it.status === 'blocked').length;
    const done = items.filter((it) => isClosed(it.status)).length;
    return { open, overdue, blocked, done };
  }, [items]);

  // "By priority": overdue floats up, then by status rank, then newer meeting first.
  const byPriority = useMemo(() => {
    return [...items].sort((a, b) => {
      const oa = isOverdue(a) ? 0 : 1;
      const ob = isOverdue(b) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
      return (b.meeting_date || '').localeCompare(a.meeting_date || '');
    });
  }, [items]);

  // "By team": one section per team, open first. Items with no team (team_name
  // null = the "General" gutter) group under "General", floated to the top.
  const byTeam = useMemo(() => {
    const teamNames = [...new Set(items.map((it) => it.team_name))];
    teamNames.sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
    return teamNames.map((team) => {
      const group = items
        .filter((it) => it.team_name === team)
        .sort((a, b) => RANK[a.status] - RANK[b.status]);
      const open = group.filter((it) => !isClosed(it.status)).length;
      return { team, group, open };
    });
  }, [items]);

  return (
    <>
      <div className="top-bar">
        <span className="top-bar-title">AI Lead</span>
      </div>

      <div className="page-body ai-lead-page">
        <div className="identity">
          <div className="id-avatar">AL</div>
          <div className="id-name">AI Lead</div>
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            id="ail-tab-actions"
            aria-controls="ail-panel-actions"
            aria-selected={tab === 'actions'}
            className={`tab${tab === 'actions' ? ' on' : ''}`}
            onClick={() => setTab('actions')}
          >
            Action items <span className="tab-badge">{counts.open} open</span>
          </button>
          <button
            type="button"
            role="tab"
            id="ail-tab-toolkit"
            aria-controls="ail-panel-toolkit"
            aria-selected={tab === 'toolkit'}
            className={`tab${tab === 'toolkit' ? ' on' : ''}`}
            onClick={() => setTab('toolkit')}
          >
            My toolkit <span className="tab-badge">{toolkitCount}</span>
          </button>
        </div>

        <div
          role="tabpanel"
          id="ail-panel-actions"
          aria-labelledby="ail-tab-actions"
          hidden={tab !== 'actions'}
        >
          {loading ? (
            <div className="text-muted text-sm">Loading action items…</div>
          ) : error ? (
            <div className="ail-load-error">{error}</div>
          ) : (
            <>
              <div className="tile-grid">
                <div className="tile acc-blue">
                  <div className="tile-label">Open</div>
                  <div className="tile-value">{counts.open}</div>
                  <div className="tile-sub">planned · in&nbsp;progress · blocked</div>
                </div>
                <div className="tile acc-red">
                  <div className="tile-label">Overdue</div>
                  <div className="tile-value">{counts.overdue}</div>
                  <div className="tile-sub">past due date</div>
                </div>
                <div className="tile acc-amber">
                  <div className="tile-label">Blocked</div>
                  <div className="tile-value">{counts.blocked}</div>
                  <div className="tile-sub">needs unblocking</div>
                </div>
                <div className="tile acc-green">
                  <div className="tile-label">Done</div>
                  <div className="tile-value">{counts.done}</div>
                  <div className="tile-sub">finished / closed</div>
                </div>
              </div>

              <div className="list-card">
                <div className="list-head">
                  <span className="list-title">
                    Action items
                    <span className="count">
                      {items.length} item{items.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="list-spacer" />
                  <div className="ail-toggle">
                    <button
                      type="button"
                      className={view === 'priority' ? 'on' : ''}
                      onClick={() => setView('priority')}
                    >
                      By priority
                    </button>
                    <button
                      type="button"
                      className={view === 'team' ? 'on' : ''}
                      onClick={() => setView('team')}
                    >
                      By team
                    </button>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                    + Add action item
                  </button>
                </div>

                {actionForm && (
                  <div className="tk-form">
                    <div className="af-title">
                      {actionForm.id === null
                        ? 'Add action item (AI Lead)'
                        : 'Edit action item'}
                    </div>
                    <div className="af-grid">
                      <div className="af-field grow">
                        <label className="af-label" htmlFor="af-text">Action item</label>
                        <input
                          id="af-text"
                          type="text"
                          className="tk-input"
                          placeholder="What needs to happen?"
                          value={actionForm.text}
                          autoFocus
                          onChange={(e) => setActionForm({ ...actionForm, text: e.target.value })}
                        />
                      </div>
                      <div className="af-field">
                        <label className="af-label" htmlFor="af-status">Status</label>
                        <select
                          id="af-status"
                          className="tk-input"
                          value={actionForm.status}
                          onChange={(e) =>
                            setActionForm({ ...actionForm, status: e.target.value as TaskStatus })
                          }
                        >
                          {STATUS_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="af-field">
                        <label className="af-label" htmlFor="af-team">Team</label>
                        <select
                          id="af-team"
                          className="tk-input"
                          // '' = the "General" gutter (team_id null); else a team id.
                          value={actionForm.team_id == null ? '' : String(actionForm.team_id)}
                          onChange={(e) =>
                            setActionForm({
                              ...actionForm,
                              team_id: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        >
                          <option value="">General</option>
                          {teams.map((t) => (
                            <option key={t.team_id} value={String(t.team_id)}>{t.team_name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="af-field">
                        <label className="af-label" htmlFor="af-due">Due date</label>
                        <input
                          id="af-due"
                          type="date"
                          className="tk-input"
                          value={actionForm.due_date}
                          onChange={(e) => setActionForm({ ...actionForm, due_date: e.target.value })}
                        />
                      </div>
                      <div className="af-field grow">
                        <label className="af-label" htmlFor="af-note">Note</label>
                        <input
                          id="af-note"
                          type="text"
                          className="tk-input"
                          placeholder="Optional note"
                          value={actionForm.note}
                          onChange={(e) => setActionForm({ ...actionForm, note: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="tk-form-actions">
                      {actionError && <span className="row-error">{actionError}</span>}
                      <span className="list-spacer" />
                      <button type="button" className="btn btn-secondary btn-sm" onClick={closeForm}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!actionForm.text.trim() || actionSaving}
                        onClick={saveAction}
                      >
                        {actionSaving ? 'Saving…' : actionForm.id === null ? 'Add' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}

                <table className="ai-table">
                  <thead>
                    <tr>
                      <th className="col-item">Action item</th>
                      <th className="col-team">Team</th>
                      <th className="col-date">Meeting date</th>
                      <th className="col-due">Due date</th>
                      <th className="col-status">Status</th>
                      <th className="col-open" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-muted text-sm" style={{ textAlign: 'center', padding: 28 }}>
                          No action items yet — add one with “+ Add action item”.
                        </td>
                      </tr>
                    ) : view === 'priority' ? (
                      byPriority.map((it) => (
                        <ItemRow
                          key={it.id}
                          it={it}
                          onPatch={patchItem}
                          onEdit={openEdit}
                          onDelete={deleteAction}
                          error={rowErrors[it.id]}
                        />
                      ))
                    ) : (
                      byTeam.map(({ team, group, open }) => (
                        <Fragment key={team ?? '__general'}>
                          <tr className="group-row">
                            <td colSpan={6}>
                              <span className="gh">
                                <span
                                  className="gdot"
                                  style={{ '--tc': team ? teamColor(team) : '#94a3b8' } as CSSProperties}
                                />
                                {team ?? 'General'}
                                <span className="gcount">
                                  {group.length} item{group.length === 1 ? '' : 's'} · {open} open
                                </span>
                              </span>
                            </td>
                          </tr>
                          {group.map((it) => (
                            <ItemRow
                              key={it.id}
                              it={it}
                              onPatch={patchItem}
                              onEdit={openEdit}
                              onDelete={deleteAction}
                              error={rowErrors[it.id]}
                            />
                          ))}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div
          role="tabpanel"
          id="ail-panel-toolkit"
          aria-labelledby="ail-tab-toolkit"
          hidden={tab !== 'toolkit'}
        >
          <Toolkit onCountChange={setToolkitCount} />
        </div>
      </div>
    </>
  );
}

function ItemRow({
  it,
  onPatch,
  onEdit,
  onDelete,
  error,
}: {
  it: AILeadActionItem;
  onPatch: (id: number, patch: ActionItemPatchBody) => void;
  onEdit: (it: AILeadActionItem) => void;
  onDelete: (it: AILeadActionItem) => void;
  error?: string | undefined;
}) {
  const standalone = isStandalone(it);
  const closed = isClosed(it.status);
  const overdue = isOverdue(it);
  return (
    <tr className={`item-row ${closed ? 'is-closed ' : ''}st-${it.status}`}>
      <td className="col-item">
        <div className="ai-text">{it.text}</div>
        {it.note && <div className="ai-note">{it.note}</div>}
        <div className="ai-item-tags">
          <span className={`kind-tag ${standalone ? 'kind-personal' : 'kind-meeting'}`}>
            {standalone ? 'Personal' : 'From report'}
          </span>
        </div>
      </td>
      <td className="col-team">
        {it.team_name ? (
          <span className="team-chip" style={{ '--tc': teamColor(it.team_name) } as CSSProperties}>
            <span className="tdot" />
            {it.team_name}
          </span>
        ) : (
          <span className="team-personal">General</span>
        )}
      </td>
      <td className="col-date">
        {it.meeting_date ? (
          <span className="mtg-date">{it.meeting_date}</span>
        ) : (
          <span className="date-dash">—</span>
        )}
      </td>
      <td className="col-due">
        <input
          type="date"
          className={`due-input${overdue ? ' overdue' : ''}`}
          value={it.due_date ?? ''}
          // Empty value clears the due date (→ null per contract).
          onChange={(e) => onPatch(it.id, { due_date: e.target.value || null })}
          aria-label="Due date"
        />
        {overdue && <div className="overdue-tag">Overdue</div>}
      </td>
      <td className="col-status">
        <span className="status-wrap">
          <span className={`status-dot sd-${it.status}`} />
          <select
            className="status-sel"
            aria-label="Status"
            value={it.status}
            onChange={(e) => onPatch(it.id, { status: e.target.value as TaskStatus })}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </span>
        {error && <div className="row-error">{error}</div>}
      </td>
      <td className="col-open">
        {/* A1+A2: every item (report-derived AND standalone) is fully editable +
            deletable here. */}
        <div className="row-acts">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(it)}>
            Edit
          </button>
          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => onDelete(it)}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---- My toolkit -----------------------------------------------------------
// The AI Lead's personal list of meta-skills + Claude Code enhancements. A
// standalone resource (`/api/ai-lead/items`) — no teams/reports. Self-contained:
// owns its own load effect; reports its count up for the tab badge.

const TOOLKIT_GROUPS: ReadonlyArray<readonly [AILeadItemCategory, string]> = [
  ['meta_skill', 'Meta-skills'],
  ['cc_enhancement', 'Claude Code enhancements'],
];

const CATEGORY_OPTIONS: ReadonlyArray<readonly [AILeadItemCategory, string]> = [
  ['meta_skill', 'Meta-skill'],
  ['cc_enhancement', 'Claude Code enhancement'],
];

type ToolkitForm = {
  // null id = adding a new item; a number = editing that item.
  id: number | null;
  name: string;
  description: string;
  category: AILeadItemCategory;
};

const BLANK_FORM: ToolkitForm = { id: null, name: '', description: '', category: 'meta_skill' };

function Toolkit({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [items, setItems] = useState<AILeadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Open form (add or edit) — null when closed. One form serves both modes.
  const [form, setForm] = useState<ToolkitForm | null>(null);
  const [saving, setSaving] = useState(false);
  // Calm inline messages: a form-level save error and a list-level action error.
  const [formError, setFormError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api.aiLead.items
      .list()
      .then((data) => {
        if (!cancelled) {
          setItems(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Couldn't load toolkit items.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Keep the parent's tab-badge count in sync with the loaded list.
  useEffect(() => { onCountChange(items.length); }, [items, onCountChange]);

  const groups = useMemo(
    () =>
      TOOLKIT_GROUPS.map(([category, label]) => ({
        category,
        label,
        rows: items.filter((it) => it.category === category),
      })),
    [items],
  );

  function openAdd() {
    setFormError(null);
    setListError(null);
    setForm({ ...BLANK_FORM });
  }

  function openEdit(it: AILeadItem) {
    setFormError(null);
    setListError(null);
    setForm({
      id: it.id,
      name: it.name,
      description: it.description ?? '',
      category: it.category,
    });
  }

  function closeForm() {
    setForm(null);
    setFormError(null);
  }

  function save() {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return; // Save is disabled, but guard anyway.
    const body = {
      name,
      description: form.description.trim() || null,
      category: form.category,
    };
    setSaving(true);
    setFormError(null);
    const req =
      form.id === null
        ? api.aiLead.items.create(body)
        : api.aiLead.items.update(form.id, body);
    req
      .then((saved) => {
        setItems((list) =>
          form.id === null
            ? [...list, saved]
            : list.map((it) => (it.id === saved.id ? saved : it)),
        );
        setSaving(false);
        setForm(null);
      })
      .catch(() => {
        setSaving(false);
        setFormError("Couldn't save — try again.");
      });
  }

  function remove(it: AILeadItem) {
    if (!confirm(`Delete "${it.name}" from your toolkit?`)) return;
    setListError(null);
    const prev = items;
    setItems((list) => list.filter((x) => x.id !== it.id));
    // If the deleted item was being edited, drop the form too.
    setForm((f) => (f && f.id === it.id ? null : f));
    api.aiLead.items
      .delete(it.id)
      .catch(() => {
        setItems(prev); // roll back
        setListError("Couldn't delete — try again.");
      });
  }

  const canSave = !!form && form.name.trim().length > 0 && !saving;

  return (
    <div className="list-card toolkit-card">
      <div className="list-head">
        <span className="list-title">
          My toolkit
          <span className="count">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="list-spacer" />
        {!form && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={openAdd}>
            + Add item
          </button>
        )}
      </div>

      {form && (
        <div className="tk-form">
          <div className="tk-form-row">
            <input
              type="text"
              className="tk-input tk-name"
              aria-label="Toolkit item name"
              placeholder="Name (e.g. “Spec-first planning”)"
              value={form.name}
              autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <select
              className="tk-input tk-cat"
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as AILeadItemCategory })
              }
              aria-label="Category"
            >
              {CATEGORY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <textarea
            className="tk-input tk-desc"
            aria-label="Toolkit item description"
            placeholder="Description (optional)"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="tk-form-actions">
            {formError && <span className="row-error">{formError}</span>}
            <span className="list-spacer" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={closeForm}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canSave}
              onClick={save}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="tk-body">
        {loading ? (
          <div className="text-muted text-sm tk-pad">Loading toolkit…</div>
        ) : loadError ? (
          <div className="ail-load-error">{loadError}</div>
        ) : items.length === 0 ? (
          <div className="tk-empty">No toolkit items yet.</div>
        ) : (
          <>
            {listError && <div className="ail-load-error tk-list-error">{listError}</div>}
            {groups.map(({ category, label, rows }) =>
              rows.length === 0 ? null : (
                <div key={category} className="tk-group">
                  <div className="tk-group-head">
                    {label}
                    <span className="tk-group-count">{rows.length}</span>
                  </div>
                  {rows.map((it) => (
                    <div key={it.id} className="tk-row">
                      <div className="tk-row-main">
                        <div className="tk-row-name">{it.name}</div>
                        {it.description && (
                          <div className="tk-row-desc">{it.description}</div>
                        )}
                      </div>
                      <div className="tk-row-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEdit(it)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-outline btn-sm"
                          onClick={() => remove(it)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}
