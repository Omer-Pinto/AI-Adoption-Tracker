import type { ArtifactType, TaskStatus } from '@/types';

// Visual primitives matching the mvp/ mockups. Three flavors cover the app:
//   - task status chips (domain/tasks pages)
//   - artifact type pills (artifacts/domain pages)
//   - artifact change-kind badges (history / story)
// Classes come from styles/design-system.css + styles/app.css.

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`status-chip status-${status}`}>{status}</span>;
}

export function ArtifactTypeBadge({ type }: { type: ArtifactType }) {
  return <span className={`artifact-type type-${type}`}>{type}</span>;
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
