import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useTheme } from '@/useTheme';
import { ChangePasswordModal } from './ChangePasswordModal';
import './SettingsMenu.css';

// Global account control pinned to the app's top-right (modern SaaS pattern).
// A compact gradient-ring avatar button opens a theme-aware dropdown with the
// signed-in identity + role, Change password, and Log out. The light/dark switch
// is a SEPARATE icon-only button (ThemeToggle, below) that sits to its LEFT in
// the same top-right cluster (assembled in AppShell). Rendered once at the shell
// level so it floats above every page's own sticky .top-bar. Present for all roles.

function roleLabel(user: {
  is_admin: boolean;
  read_all: boolean;
  teams: number[];
}): string {
  if (user.is_admin) return 'Administrator';
  if (user.read_all) return 'All-team viewer';
  const n = user.teams.length;
  return n === 1 ? '1-team viewer' : `${n}-team viewer`;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// Standalone icon-only light/dark switch, placed immediately LEFT of the avatar
// in the shell's top-right cluster. Shows the icon of the mode it switches TO
// (sun in dark, moon in light); the native title + aria-label describe the
// action. Persistence + data-theme flip are delegated to useTheme (unchanged).
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      className="account-theme-toggle"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

export function SettingsMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  async function handleLogout() {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  const initial = user.username.charAt(0) || '?';

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="account-avatar" aria-hidden="true">
          <span className="account-avatar-inner">{initial}</span>
        </span>
        <span className="account-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="account-popover" role="menu">
          <div className="account-head">
            <span className="account-avatar account-avatar-lg" aria-hidden="true">
              <span className="account-avatar-inner">{initial}</span>
            </span>
            <span className="account-identity">
              <span className="account-username">{user.username}</span>
              <span className="account-role">{roleLabel(user)}</span>
            </span>
          </div>

          <div className="account-divider" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="account-item"
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
          >
            <span className="account-item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-item is-danger"
            onClick={() => void handleLogout()}
          >
            <span className="account-item-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
            </span>
            Log out
          </button>
        </div>
      )}

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
