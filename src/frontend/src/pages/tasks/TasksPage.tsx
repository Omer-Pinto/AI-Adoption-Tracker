import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Task, TaskHistoryEntry, TaskStatus } from '@/types';
import { StatusBadge } from '@/components/Badge';
import { SearchBar } from '@/search/SearchBar';
import { useSearchQuery } from '@/search/useSearchQuery';
import { EmptyState, ErrorState } from '@/components/EmptyState';
import { useAuth } from '@/auth/AuthContext';

// Route: "/tasks" — all tasks with week-by-week journey expand.

export default function TasksPage() {
  const [query, setQuery] = useSearchQuery();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Separate, non-blocking flag for a failed history expand (calm inline note).
  const [historyError, setHistoryError] = useState(false);

  // Map of expanded task id → history (undefined = not yet loaded, null = loading)
  const [expandedMap, setExpandedMap] = useState<Map<number, TaskHistoryEntry[] | null>>(
    new Map(),
  );

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setHistoryError(false);
    // Collapse all expansions when query changes
    setExpandedMap(new Map());
    api.views
      .tasks(query || undefined)
      .then((data) => {
        if (!cancelled) {
          setTasks(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => load(), [load]);

  function toggleExpand(task: Task) {
    setExpandedMap((prev) => {
      const next = new Map(prev);
      if (next.has(task.id)) {
        // Collapse
        next.delete(task.id);
        return next;
      }
      // Expand — start loading (null = loading state)
      next.set(task.id, null);
      api.views.task(task.id).then((detail) => {
        setExpandedMap((m) => {
          const updated = new Map(m);
          // Only set if still open (user may have re-collapsed)
          if (updated.has(task.id)) {
            updated.set(task.id, detail.history);
          }
          return updated;
        });
      }).catch(() => {
        setExpandedMap((m) => {
          const updated = new Map(m);
          updated.delete(task.id);
          return updated;
        });
        setHistoryError(true);
      });
      return next;
    });
  }

  function isExpanded(id: number): boolean {
    return expandedMap.has(id);
  }

  return (
    <>
      <div className="top-bar">
        <div>
          <span className="top-bar-title">Tasks</span>
          <span className="top-bar-sub">All tasks across all domains &bull; expand a row for week-by-week journey</span>
        </div>
      </div>

      <div className="page-body">
        <SearchBar query={query} onChange={setQuery} />

        {historyError && (
          <div className="warning-banner" style={{ marginBottom: 16 }}>
            Couldn&apos;t load that task&apos;s history. Please try again.
          </div>
        )}

        {loading ? (
          <div className="text-muted text-sm">Loading tasks…</div>
        ) : error ? (
          <div className="panel">
            <ErrorState
              title="Couldn't load tasks"
              hint="The tasks list failed to load. Try again."
              onRetry={load}
            />
          </div>
        ) : tasks.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon="▣"
              title={query ? 'No matching tasks' : 'No tasks yet'}
              hint={
                query
                  ? 'Nothing matches that search. Try clearing the filter.'
                  : 'Tasks appear here as they are captured in reports.'
              }
            />
          </div>
        ) : (
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Started</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <TaskRows
                    key={task.id}
                    task={task}
                    expanded={isExpanded(task.id)}
                    history={expandedMap.get(task.id) ?? null}
                    onToggle={() => toggleExpand(task)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── TaskRows — main row + expandable journey sub-row ─────────────────────────

interface TaskRowsProps {
  task: Task;
  expanded: boolean;
  history: TaskHistoryEntry[] | null; // null = still loading
  onToggle: () => void;
}

function TaskRows({ task, expanded, history, onToggle }: TaskRowsProps) {
  const isAbandoned = task.status === 'abandoned';
  const colSpan = 6;

  return (
    <>
      <tr className={expanded ? 'task-row-expanded' : ''}>
        <td>
          <button
            type="button"
            className="expand-btn"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </td>
        <td>
          <span className={isAbandoned ? 'task-name-abandoned' : ''} style={{ fontWeight: 600, color: '#1a1d23' }}>
            {task.name}
          </span>
        </td>
        <td>
          <StatusBadge status={task.status} />
        </td>
        <td style={{ color: '#374151' }}>{task.owner ?? <span className="text-muted">—</span>}</td>
        <td className="text-sm" style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
          {task.started_on ?? <span style={{ color: '#d1d5db' }}>—</span>}
        </td>
        <td className="text-sm" style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>
          {task.due_date ?? <span style={{ color: '#d1d5db' }}>—</span>}
        </td>
      </tr>

      {expanded && (
        <tr className="journey-row-expanded">
          <td colSpan={colSpan} className="journey-cell">
            <div className="journey-inner">
              <div className="journey-title">Week-by-week journey</div>
              {history === null ? (
                <div className="text-muted text-sm">Loading…</div>
              ) : history.length === 0 ? (
                <div className="text-muted text-sm">No history recorded yet.</div>
              ) : (
                <JourneyTimeline history={history} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── JourneyTimeline ───────────────────────────────────────────────────────────

function dotClass(status: TaskStatus): string {
  return `journey-dot dot-${status}`;
}

function JourneyTimeline({ history }: { history: TaskHistoryEntry[] }) {
  const { isAdmin } = useAuth();
  return (
    <div className="journey-timeline">
      {history.map((entry) => (
        <div className="journey-step" key={entry.id}>
          <span className={dotClass(entry.status_at_meeting)} />
          <div className="journey-step-header">
            <span className="journey-step-date">{entry.meeting_date}</span>
            <StatusBadge status={entry.status_at_meeting} />
            {/* report_id is present on TaskHistoryEntry — the report editor is
                admin-only, so non-admins get no "Edit report" link. */}
            {isAdmin && (
              <Link
                to={`/reports/${entry.report_id}/edit`}
                className="btn btn-sm btn-outline"
                style={{ fontSize: 11, padding: '1px 7px', marginLeft: 6 }}
                title="Edit the report that recorded this entry"
              >
                Edit report
              </Link>
            )}
          </div>
          {entry.change_note && (
            <p className="journey-step-note">{entry.change_note}</p>
          )}
        </div>
      ))}
    </div>
  );
}
