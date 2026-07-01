import { Navigate, Outlet } from 'react-router-dom';
import type { AuthUser } from '@/types';
import { useAuth } from './AuthContext';

// Auth gate for the AppShell subtree. Unauthenticated → /login. While the
// mount-time rehydrate runs we hold on a calm full-screen loader (so a page
// flash of /login never appears for an already-signed-in user).

/**
 * Post-login landing target for a user:
 *   - admin or `read_all` → the Teams index (`/`)
 *   - a single-team scoped user → that team's page
 *   - anything else (0 or 2+ teams) → `/`
 */
export function landingPath(user: AuthUser): string {
  if (user.is_admin || user.read_all) return '/';
  if (user.teams.length === 1) return `/teams/${user.teams[0]}`;
  return '/';
}

export function ProtectedRoute() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-faint)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return <Outlet />;
}
