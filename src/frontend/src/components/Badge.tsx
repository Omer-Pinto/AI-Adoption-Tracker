import type { ArtifactType, TaskStatus } from '@/types';

// Visual primitives matching the mvp/ mockups. Three flavors cover the app:
//   - task status chips (domain/tasks pages)
//   - artifact type pills (artifacts/domain pages)
//   - artifact change-kind badges (history / story)
// Classes come from styles/design-system.css + styles/app.css.

// Human-readable status labels (mirrors the report-editor STATUS_OPTS labels).
const STATUS_LABELS: Record<TaskStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  finished_successfully: 'Finished',
  finished_with_issues: 'Finished w/ issues',
  blocked: 'Blocked',
  abandoned: 'Abandoned',
  wont_fix: "Won't Fix",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`status-chip status-${status}`}>{STATUS_LABELS[status]}</span>;
}

// Human-readable artifact-type labels. Covers the full 7-value union so new
// types (workflow / mcp / other) render nicely rather than as raw enum text.
export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  agent: 'agent',
  skill: 'skill',
  hook: 'hook',
  context: 'context',
  workflow: 'workflow',
  mcp: 'MCP',
  other: 'other',
};

export function ArtifactTypeBadge({ type }: { type: ArtifactType }) {
  return (
    <span className={`artifact-type type-${type}`}>
      {ARTIFACT_TYPE_LABELS[type] ?? type}
    </span>
  );
}

export function ChangeKindBadge({ kind }: { kind: string }) {
  return <span className={`change-kind ${kind}`}>{kind}</span>;
}

export function Tag({ children }: { children: string }) {
  return <span className={`tag tag-${children}`}>{children}</span>;
}

export function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="tag-list">
      {tags.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
    </div>
  );
}
