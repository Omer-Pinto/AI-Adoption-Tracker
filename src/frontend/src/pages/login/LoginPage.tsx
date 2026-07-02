import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';
import './login.css';

// Full-page sign-in, rendered OUTSIDE the AppShell (no sidebar/nav). A split
// hero: an aurora brand panel on wide screens + an elevated glass sign-in card,
// all on the shared design-system tokens so it reads correctly in light and
// dark. On success we route to the user's landing (admin/read-all → Teams
// index; single-team scoped → that team's page).

// Brand mark — the aurora "spark" the sidebar uses (AppShell.nav-logo-mark),
// so the login mark and the in-app mark are the same identity.
function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <span className="login-logo-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size} role="presentation" focusable="false">
        <defs>
          <linearGradient id="loginLogoMark" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4f46e5" />
            <stop offset="0.52" stopColor="#7c3aed" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <path
          fill="url(#loginLogoMark)"
          d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"
        />
        <path
          fill="url(#loginLogoMark)"
          opacity="0.9"
          d="M20 3l.63 1.9L22.5 5.5l-1.87.6L20 8l-.63-1.9L17.5 5.5l1.87-.6z"
        />
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
      {/* Ambient aurora backdrop — decorative, reduced-motion-safe. */}
      <div className="login-aurora" aria-hidden="true" />

      {/* Brand / marketing panel — only shows on wide screens. */}
      <aside className="login-hero" aria-hidden="true">
        <div className="login-hero-inner">
          <LogoMark size={52} />
          <h2 className="login-hero-title">AI Adoption Tracker</h2>
          <p className="login-hero-tagline">
            Turn a champion's meeting notes into a living picture of your team's
            Claude&nbsp;Code adoption — tasks, artifacts, and momentum over time.
          </p>
          <ul className="login-hero-points">
            <li>Structured weekly reports from raw notes</li>
            <li>Domain, task &amp; artifact tracking</li>
            <li>Adoption trends at a glance</li>
          </ul>
        </div>
      </aside>

      {/* Sign-in card. */}
      <main className="login-form-panel">
        <form className="login-card anim-enter" onSubmit={handleSubmit}>
          <div className="login-brand">
            <LogoMark size={40} />
            <div className="login-brand-text">
              <span className="login-eyebrow">Welcome back</span>
              <h1 className="login-title">Sign in</h1>
            </div>
          </div>
          <p className="login-subtitle">Sign in to continue to the Adoption Tracker.</p>

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
      </main>
    </div>
  );
}
