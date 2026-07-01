import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';

// Curated 404 surface — the catch-all route inside the AppShell. Calm and
// theme-aware, mirroring ForbiddenPage's layout.

const wrapStyle: CSSProperties = {
  minHeight: '60vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
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
  fontSize: 24,
  fontWeight: 700,
};

export default function NotFoundPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user ? landingPath(user) : '/login';

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={iconStyle} aria-hidden="true">
          ?
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          Page not found
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          The page you're looking for doesn't exist or may have moved.
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
