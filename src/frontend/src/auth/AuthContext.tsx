import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, getAuthToken, setAuthToken } from '@/api';
import type { AuthUser } from '@/types';

// The app's first React Context. Holds the signed-in identity + the auth verbs.
// The bearer token lives in localStorage (mirrored into api.ts via setAuthToken);
// on mount we rehydrate the user from `GET /api/auth/me` if a token is present,
// logging out on any failure (401 = expired). RBAC is read-only-except-admin:
// `isAdmin` edits everything; everyone else reads either all teams (`readAll`) or
// the explicit `readableTeams` list.

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAdmin: boolean;
  readAll: boolean;
  /** Explicitly-visible team ids (empty when admin/`readAll` grants all). */
  readableTeams: number[];
  /** True while the mount-time `me()` rehydrate is in flight. */
  initializing: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [initializing, setInitializing] = useState(true);

  // On mount: if a token was persisted, rehydrate the identity. Any failure
  // (expired token → 401) clears the session so we fall through to /login.
  useEffect(() => {
    if (!getAuthToken()) {
      setInitializing(false);
      return;
    }
    let cancelled = false;
    api.auth
      .me()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (cancelled) return;
        setAuthToken(null);
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function login(username: string, password: string): Promise<AuthUser> {
    const res = await api.auth.login(username, password);
    setAuthToken(res.token);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }

  async function logout(): Promise<void> {
    try {
      await api.auth.logout();
    } catch {
      // Best-effort server-side invalidation; clear locally regardless.
    }
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }

  async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await api.auth.changePassword(oldPassword, newPassword);
  }

  const value: AuthContextValue = {
    user,
    token,
    isAdmin: user?.is_admin ?? false,
    readAll: user?.read_all ?? false,
    readableTeams: user?.teams ?? [],
    initializing,
    login,
    logout,
    changePassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
