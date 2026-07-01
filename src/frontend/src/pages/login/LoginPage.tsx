import { useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';

// Full-page sign-in, rendered OUTSIDE the AppShell (no sidebar/nav). A single
// centered card using the shared form-input / btn classes + theme tokens, so it
// reads correctly in light and dark. On success we route to the user's landing
// (admin/read-all → Teams index; single-team scoped → that team's page).

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'var(--bg)',
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '32px 28px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(username, password);
      navigate(landingPath(user), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Incorrect username or password.'
          : 'Sign-in failed. Please try again in a moment.',
      );
      setSubmitting(false);
    }
  }

  const canSubmit = username.trim() !== '' && password !== '' && !submitting;

  return (
    <div style={pageStyle}>
      <form style={cardStyle} onSubmit={handleSubmit}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
          Sign in
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          AI Adoption Tracker
        </p>

        {error && (
          <p
            role="alert"
            style={{ color: '#ef4444', fontSize: 13, margin: '0 0 14px' }}
          >
            {error}
          </p>
        )}

        <div className="form-row">
          <label className="form-label form-label-required" htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            className="form-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="form-row">
          <label className="form-label form-label-required" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="form-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit}
          style={{ width: '100%', marginTop: 8 }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
