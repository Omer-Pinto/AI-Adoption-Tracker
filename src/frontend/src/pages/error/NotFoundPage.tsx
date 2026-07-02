import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';

// Curated 404 surface — the catch-all route inside the AppShell. Calm, on-brand
// and theme-aware, mirroring ForbiddenPage's layout.

const wrapStyle: CSSProperties = {
  minHeight: '60vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--sp-6)',
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

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user ? landingPath(user) : '/login';

  return (
    <div style={wrapStyle}>
      <div className="anim-enter" style={cardStyle}>
        <div style={iconStyle} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M9.2 9a2 2 0 0 1 3.5 1.2c0 1.2-1.8 1.6-1.8 2.8" />
            <path d="M11 16.2h.01" />
            <path d="m20 20-3.2-3.2" />
          </svg>
        </div>
        <span style={eyebrowStyle}>404 · Not found</span>
        <h1 style={titleStyle}>Page not found</h1>
        <p style={bodyStyle}>
          The page you're looking for doesn't exist or may have moved.
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
