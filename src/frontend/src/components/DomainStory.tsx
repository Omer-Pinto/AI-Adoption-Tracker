import './DomainStory.css';
import type { Task, Artifact, TaskHistoryEntry, ArtifactHistoryEntry, TaskStatus, ArtifactChangeKind } from '@/types';
import { StatusBadge, ChangeKindBadge } from '@/components/Badge';

// Shared "week-by-week story" timeline component.
// Used by DomainPage (standalone, with connectors) and TeamPage's DomainCard
// (embedded, without connectors). The only behavioral difference is the
// connector line between entries within a date group, controlled by the
// `connectors` prop (default false).

export interface DomainStoryProps {
  /** Current-state tasks — used for name resolution (task_id → name). */
  tasks: Task[];
  /** Current-state artifacts — used for name resolution (artifact_id → name). */
  artifacts: Artifact[];
  /** Ordered task history rows (from the API payload). */
  taskHistory: TaskHistoryEntry[];
  /** Ordered artifact history rows (from the API payload). */
  artifactHistory: ArtifactHistoryEntry[];
  /** Called when the user clicks an artifact name. */
  onArtifactClick: (id: number) => void;
  /**
   * When true, renders a vertical connector line between consecutive entries
   * within each date group (DomainPage style). Defaults to false (TeamPage style).
   */
  connectors?: boolean;
}

type StoryEntry =
  | {
      kind: 'task';
      date: string;
      id: number;
      taskId: number;
      taskName: string;
      status: TaskStatus;
      note: string | null;
    }
  | {
      kind: 'artifact';
      date: string;
      id: number;
      artifactId: number;
      artifactName: string;
      changeKind: ArtifactChangeKind;
      note: string | null;
    };

export function DomainStory({
  tasks,
  artifacts,
  taskHistory,
  artifactHistory,
  onArtifactClick,
  connectors = false,
}: DomainStoryProps) {
  // Build name-resolution maps from current-state arrays
  const taskNameMap = new Map<number, string>(tasks.map((t) => [t.id, t.name]));
  const artifactNameMap = new Map<number, string>(artifacts.map((a) => [a.id, a.name]));

  const entries: StoryEntry[] = [
    ...taskHistory.map((h) => ({
      kind: 'task' as const,
      date: h.meeting_date,
      id: h.id,
      taskId: h.task_id,
      taskName: taskNameMap.get(h.task_id) ?? `Task #${h.task_id}`,
      status: h.status_at_meeting,
      note: h.change_note,
    })),
    ...artifactHistory.map((h) => ({
      kind: 'artifact' as const,
      date: h.meeting_date,
      id: h.id,
      artifactId: h.artifact_id,
      artifactName: artifactNameMap.get(h.artifact_id) ?? `Artifact #${h.artifact_id}`,
      changeKind: h.change_kind,
      note: h.change_note,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Group by meeting date
  const byDate = new Map<string, StoryEntry[]>();
  for (const e of entries) {
    const bucket = byDate.get(e.date) ?? [];
    bucket.push(e);
    byDate.set(e.date, bucket);
  }
  const sortedDates = Array.from(byDate.keys()).sort();

  if (sortedDates.length === 0) {
    return (
      <div className="text-muted text-sm" style={{ padding: '8px 0' }}>
        No history yet for this domain.
      </div>
    );
  }

  return (
    <div className="story-timeline">
      {sortedDates.map((date) => {
        const dayEntries = byDate.get(date)!;
        return (
          <div key={date} className="story-date-group stagger-children">
            <div className="story-date-heading">
              <span className="story-date-label">{date}</span>
              <div className="story-date-line" />
            </div>

            {dayEntries.map((entry, idx) => {
              const isLast = idx === dayEntries.length - 1;
              return (
                <div key={`${entry.kind}-${entry.id}`} className="story-entry">
                  <div className="story-dot-col">
                    <div
                      className={`story-dot ${
                        entry.kind === 'artifact'
                          ? 'dot-artifact'
                          : entry.status === 'finished_successfully'
                          ? 'dot-finished'
                          : 'dot-task'
                      }`}
                    />
                    {connectors && !isLast && <div className="story-connector" />}
                  </div>
                  <div className="story-content">
                    {entry.kind === 'task' ? (
                      <>
                        <div className="story-what">
                          <span className="story-entity-type type-task">task</span>
                          {entry.taskName}
                        </div>
                        <div className="story-meta">
                          <StatusBadge status={entry.status} />
                        </div>
                        {entry.note && <div className="story-note">{entry.note}</div>}
                      </>
                    ) : (
                      <>
                        <div className="story-what">
                          <span className="story-entity-type type-artifact">artifact</span>
                          <span
                            className="story-artifact-link"
                            onClick={() => onArtifactClick(entry.artifactId)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) =>
                              e.key === 'Enter' && onArtifactClick(entry.artifactId)
                            }
                          >
                            {entry.artifactName}
                          </span>
                          {' — '}
                          <ChangeKindBadge kind={entry.changeKind} />
                        </div>
                        {entry.note && <div className="story-note">{entry.note}</div>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
