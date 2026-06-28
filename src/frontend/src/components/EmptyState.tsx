import type { ReactNode } from 'react';

// Shared, dependency-free calm states for list / viewer pages.
//
// EmptyState  → a successful load that returned nothing (fresh/empty DB, no
//               matching rows). Quiet, on-brand, never alarming.
// ErrorState  → a genuine load failure. A short human sentence (never a raw
//               `ApiError: GET … → 500` string) with an optional Retry that
//               simply re-runs the page's existing loader.
//
// Both render a centered, muted column. They intentionally carry no red/scary
// chrome — a fresh install and a transient blip should both feel calm.

const wrap = (compact?: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 6,
  padding: compact ? '28px 18px' : '56px 24px',
  color: '#6b7280',
});

const iconStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f3f4f6',
  color: '#9ca3af',
  fontSize: 20,
  lineHeight: 1,
  marginBottom: 4,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#374151',
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#9ca3af',
  maxWidth: 360,
  lineHeight: 1.5,
};

interface EmptyStateProps {
  /** Small glyph or node shown in the muted circle. Defaults to a calm dot. */
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  /** Tighter padding for in-panel / in-fold use. */
  compact?: boolean;
}

export function EmptyState({ icon = '○', title, hint, compact }: EmptyStateProps) {
  return (
    <div style={wrap(compact)}>
      <div style={iconStyle} aria-hidden>{icon}</div>
      <div style={titleStyle}>{title}</div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  hint?: ReactNode;
  /** When provided, renders a Retry button that re-runs the existing loader. */
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorState({
  title = "Couldn't load this",
  hint = 'Something went wrong. Please try again in a moment.',
  onRetry,
  compact,
}: ErrorStateProps) {
  return (
    <div style={wrap(compact)} role="alert">
      <div style={iconStyle} aria-hidden>!</div>
      <div style={titleStyle}>{title}</div>
      {hint && <div style={hintStyle}>{hint}</div>}
      {onRetry && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  );
}
