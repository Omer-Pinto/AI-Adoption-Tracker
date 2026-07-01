import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';
import './login.css';

// Full-page sign-in, rendered OUTSIDE the AppShell (no sidebar/nav). A single
// centered card using the shared theme tokens (see login.css), so it reads
// correctly in light and dark. On success we route to the user's landing
// (admin/read-all → Teams index; single-team scoped → that team's page).

// Brand mark — the same gradient logo the sidebar uses (AppShell.nav-logo-mark).
function LogoMark() {
  return (
    <span className="login-logo-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="44" height="44" role="presentation" focusable="false">
        <defs>
          <linearGradient id="loginLogoMark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5b73f0" />
            <stop offset="1" stopColor="#3a4fd0" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#loginLogoMark)" />
        <path
          d="M7 22 L13 15.5 L18.5 18.5 L25 9.5"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="7" cy="22" r="2.2" fill="#ffffff" />
        <circle cx="13" cy="15.5" r="2.2" fill="#ffffff" />
        <circle cx="18.5" cy="18.5" r="2.2" fill="#ffffff" />
        <circle cx="25" cy="9.5" r="2.7" fill="#ffffff" />
      </svg>
    </span>
  );
}

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
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <LogoMark />
          <h1 className="login-title">AI Adoption Tracker</h1>
          <p className="login-subtitle">Sign in to continue</p>
        </div>

        {error && (
          <div className="login-error" role="alert">
            <svg
              className="login-error-icon"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div className="login-field">
          <label className="login-label" htmlFor="login-username">
            Username
          </label>
          <input
            id="login-username"
            className="login-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="login-field">
          <label className="login-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button type="submit" className="login-submit" disabled={!canSubmit}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
