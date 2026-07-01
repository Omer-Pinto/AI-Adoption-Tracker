import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { AuthUser } from '@/types';
import { useAuth } from './AuthContext';

// Auth gate for the AppShell subtree. Unauthenticated → /login. While the
// mount-time rehydrate runs we hold on a calm full-screen loader (so a page
// flash of /login never appears for an already-signed-in user).

/**
 * A "scoped champion": a team-scoped user (not admin, not a `read_all` manager)
 * bound to exactly one team. These users never see the teams index; they live on
 * the clean id-less `/ai_adoption` view of their own team. Admin and `read_all`
 * managers are NOT scoped champions and keep the full cross-team experience.
 */
export function isScopedChampion(user: AuthUser): boolean {
  return !user.is_admin && !user.read_all && user.teams.length === 1;
}

/**
 * Post-login landing target for a user:
 *   - admin or `read_all` → the Teams index (`/`)
 *   - a scoped champion (single team) → their id-less team view (`/ai_adoption`)
 *   - anything else (0 or 2+ teams, non-admin) → `/`
 */
export function landingPath(user: AuthUser): string {
  if (user.is_admin || user.read_all) return '/';
  if (isScopedChampion(user)) return '/ai_adoption';
  return '/';
}

export function ProtectedRoute() {
  const { user, initializing } = useAuth();
  const location = useLocation();

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

  // A scoped champion never sees the teams index. If they land on `/` (direct
  // nav or refresh), funnel them to their id-less own-team view. Admin and
  // `read_all` managers keep the index — do not redirect them.
  if (isScopedChampion(user) && location.pathname === '/') {
    return <Navigate to="/ai_adoption" replace />;
  }

  return <Outlet />;
}
