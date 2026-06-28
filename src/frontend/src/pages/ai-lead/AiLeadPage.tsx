import { Fragment, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { ActionItemPatchBody, AILeadActionItem, TaskStatus } from '@/types';
import './ai-lead-page.css';

// Route: "/ai-lead" — the personal cross-team view of every action item owned by
// the literal 'AI Lead', pulled from all teams' reports. Built to match
// prototype/ai-lead-mock.html. This is NOT a team page.

type View = 'priority' | 'team';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('priority');
  // Per-row inline save errors (keyed by item id), set on a failed PATCH.
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

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
    return () => { cancelled = true; };
  }, []);

  // Persisted edit: optimistically apply the patch, PATCH the backend, then
  // reconcile the row from the returned bare ActionItem (status/due_date only —
  // the cross-team fields are NOT returned). Roll back + surface an inline error
  // on failure.
  function patchItem(id: number, patch: ActionItemPatchBody) {
    const prev = items.find((it) => it.id === id);
    if (!prev) return;
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setRowErrors((e) => {
      if (!(id in e)) return e;
      const next = { ...e };
      delete next[id];
      return next;
    });
    api.aiLead
      .patch(id, patch)
      .then((updated) => {
        setItems((list) =>
          list.map((it) =>
            it.id === id
              ? { ...it, status: updated.status ?? it.status, due_date: updated.due_date }
              : it,
          ),
        );
      })
      .catch(() => {
        setItems((list) => list.map((it) => (it.id === id ? prev : it)));
        setRowErrors((e) => ({ ...e, [id]: "Couldn't save — try again." }));
      });
  }

  const counts = useMemo(() => {
    const open = items.filter((it) => !isClosed(it.status)).length;
    const overdue = items.filter(isOverdue).length;
    const blocked = items.filter((it) => it.status === 'blocked').length;
    const done = items.filter((it) => isClosed(it.status)).length;
    const teams = new Set(items.map((it) => it.team_name)).size;
    return { open, overdue, blocked, done, teams };
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

  // "By team": one section per team (insertion order by team name), open first.
  const byTeam = useMemo(() => {
    const teams = [...new Set(items.map((it) => it.team_name))];
    return teams.map((team) => {
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
        <div>
          <span className="top-bar-title">AI Lead</span>
          <span className="top-bar-sub">My action items across all teams</span>
        </div>
        <div className="top-bar-actions">
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
        </div>
      </div>

      <div className="page-body ai-lead-page">
        <div className="identity">
          <div className="id-avatar">AL</div>
          <div>
            <div className="id-name">AI Lead — my action items</div>
            <div className="id-meta">
              Action items assigned to the <b>AI Lead</b>, pulled from every team&apos;s reports
            </div>
          </div>
        </div>

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
                  My action items
                  <span className="count">
                    {items.length} across {counts.teams} team{counts.teams === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="list-spacer" />
                <span className="sort-note">
                  {view === 'priority'
                    ? 'Open & overdue first · closed sink to the bottom'
                    : 'Grouped by team · open items first within each'}
                </span>
              </div>

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
                        No action items assigned to the AI Lead yet.
                      </td>
                    </tr>
                  ) : view === 'priority' ? (
                    byPriority.map((it) => (
                      <ItemRow key={it.id} it={it} onPatch={patchItem} error={rowErrors[it.id]} />
                    ))
                  ) : (
                    byTeam.map(({ team, group, open }) => (
                      <Fragment key={team}>
                        <tr className="group-row">
                          <td colSpan={6}>
                            <span className="gh">
                              <span className="gdot" style={{ '--tc': teamColor(team) } as CSSProperties} />
                              {team}
                              <span className="gcount">
                                {group.length} item{group.length === 1 ? '' : 's'} · {open} open
                              </span>
                            </span>
                          </td>
                        </tr>
                        {group.map((it) => (
                          <ItemRow key={it.id} it={it} onPatch={patchItem} error={rowErrors[it.id]} />
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
    </>
  );
}

function ItemRow({
  it,
  onPatch,
  error,
}: {
  it: AILeadActionItem;
  onPatch: (id: number, patch: ActionItemPatchBody) => void;
  error?: string | undefined;
}) {
  const closed = isClosed(it.status);
  const overdue = isOverdue(it);
  return (
    <tr className={`${closed ? 'is-closed ' : ''}st-${it.status}`}>
      <td className="col-item"><div className="ai-text">{it.text}</div></td>
      <td className="col-team">
        <span className="team-chip" style={{ '--tc': teamColor(it.team_name) } as CSSProperties}>
          <span className="tdot" />
          {it.team_name}
        </span>
      </td>
      <td className="col-date">
        {it.meeting_date ? (
          <span className="mtg-date">{it.meeting_date}</span>
        ) : (
          <span className="mtg-none">no date</span>
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
        <Link
          to={`/reports/${it.report_id}/edit`}
          className="btn btn-secondary btn-sm"
          title="Open the report this item lives on"
        >
          Open report ↗
        </Link>
      </td>
    </tr>
  );
}
