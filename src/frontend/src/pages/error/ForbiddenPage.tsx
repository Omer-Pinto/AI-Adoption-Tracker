import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';

// Curated 403 surface. Rendered both as the public `/403` route (when the api
// layer throws ForbiddenError) and inline by the admin-only Users portal for a
// non-admin. Centered, calm, on-brand, theme-aware — fills its container.

const wrapStyle: CSSProperties = {
  minHeight: '60vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-6)',
  background: 'var(--bg)',
  flex: 1,
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 'var(--sp-3)',
  maxWidth: 420,
};

const iconStyle: CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: 'var(--r-lg)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--grad-aurora-soft)',
  border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
  color: 'var(--accent)',
  marginBottom: 'var(--sp-2)',
};

const eyebrowStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 'var(--tracking-eyebrow)',
  color: 'var(--text-faint)',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--text-2xl)',
  fontWeight: 600,
  letterSpacing: 'var(--tracking-tight)',
  lineHeight: 'var(--lh-tight)',
  color: 'var(--text)',
  margin: 0,
};

const bodyStyle: CSSProperties = {
  fontSize: 'var(--text-base)',
  color: 'var(--text-muted)',
  margin: 0,
  lineHeight: 'var(--lh-base)',
  maxWidth: '42ch',
};

export default function ForbiddenPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user ? landingPath(user) : '/login';

  return (
    <div style={wrapStyle}>
      <div className="anim-enter" style={cardStyle}>
        <div style={iconStyle} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <span style={eyebrowStyle}>403 · Forbidden</span>
        <h1 style={titleStyle}>You don't have access to this</h1>
        <p style={bodyStyle}>
          This area is restricted. If you think you should be able to see it, ask your
          administrator to adjust your access.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 'var(--sp-3)' }}
          onClick={() => navigate(home, { replace: true })}
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
