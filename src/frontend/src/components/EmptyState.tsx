import type { CSSProperties, ReactNode } from 'react';

// Shared, dependency-free calm states for list / viewer pages.
//
// EmptyState  → a successful load that returned nothing (fresh/empty DB, no
//               matching rows). Quiet, on-brand, never alarming.
// ErrorState  → a genuine load failure. A short human sentence (never a raw
//               `ApiError: GET … → 500` string) with an optional Retry that
//               simply re-runs the page's existing loader.
//
// Both render a centered, muted column that reads correctly in light AND dark
// (token-based — no hard-coded hex). A fresh install and a transient blip should
// both feel calm: no red/scary chrome.

const wrap = (compact?: boolean): CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 'var(--sp-2)',
  padding: compact ? 'var(--sp-6) var(--sp-5)' : 'var(--sp-8) var(--sp-6)',
  color: 'var(--text-muted)',
});

const iconStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 'var(--r-lg)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface-3)',
  border: '1px solid var(--border)',
  color: 'var(--text-faint)',
  fontSize: 20,
  lineHeight: 1,
  marginBottom: 'var(--sp-1)',
};

const titleStyle: CSSProperties = {
  fontSize: 'var(--text-md)',
  fontWeight: 600,
  color: 'var(--text)',
  letterSpacing: 'var(--tracking-snug)',
};

const hintStyle: CSSProperties = {
  fontSize: 'var(--text-base)',
  color: 'var(--text-muted)',
  maxWidth: 360,
  lineHeight: 'var(--lh-base)',
};

interface EmptyStateProps {
  /** Small glyph or node shown in the muted badge. Defaults to a calm dot. */
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
          style={{ marginTop: 'var(--sp-2)' }}
          onClick={onRetry}
        >
          Try again
        </button>
      )}
    </div>
  );
}
