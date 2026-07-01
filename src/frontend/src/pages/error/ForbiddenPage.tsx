import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';

// Curated 403 surface. Rendered both as the public `/403` route (when the api
// layer throws ForbiddenError) and inline by the admin-only Users portal for a
// non-admin. Centered, calm, theme-aware — fills whatever container it's in.

const wrapStyle: CSSProperties = {
  minHeight: '60vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'var(--bg)',
  flex: 1,
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: 8,
  maxWidth: 400,
};

const iconStyle: CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--surface-3)',
  color: 'var(--text-faint)',
  marginBottom: 8,
};

export default function ForbiddenPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user ? landingPath(user) : '/login';

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={iconStyle} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          You don't have access to this
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          This area is restricted. If you think you should be able to see it, ask your
          administrator to adjust your access.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={() => navigate(home, { replace: true })}
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
