import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { api } from '@/api';
import type { TeamPageIndexEntry } from '@/types';
import { useAuth } from '@/auth/AuthContext';
import { landingPath } from '@/auth/ProtectedRoute';
import { SettingsMenu, ThemeToggle } from './SettingsMenu';

// Sidebar + main-content shell, reusing the mvp/ look (.app-shell, .nav-sidebar).
// Nav is RBAC-aware (Wave 18):
//   * admin        → everything, incl. New Report / Manage / Users.
//   * all-team     → the read-only cross-team views (Teams / Artifacts / Tasks /
//     viewer          AI Lead); no create/edit, no Manage/Users.
//   * scoped       → only their own team page(s) + Settings; cross-team nav is
//     viewer          hidden entirely (not greyed).
// Routed pages render in the <Outlet/>.

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'nav-item active' : 'nav-item';
}

// Cohesive line-icon set (Lucide/Feather language): 24x24 viewBox, currentColor,
// 1.75px stroke, rounded caps/joins. Color is inherited from .nav-item so the
// existing active/hover theming keeps working.
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        role="presentation"
        focusable="false"
      >
        {children}
      </svg>
    </span>
  );
}

// The people/team glyph, reused by every team-scoped nav link (Teams, Users,
// and each scoped viewer's own-team link).
function PeopleIconPaths() {
  return (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  );
}

export function AppShell() {
  const { user, isAdmin, readAll } = useAuth();
  const [version, setVersion] = useState('');
  // A scoped viewer (not admin, not all-team) sees only their own team links;
  // everyone else (admin or all-team viewer) gets the cross-team read views.
  const scoped = !isAdmin && !readAll;
  const [scopedTeams, setScopedTeams] = useState<TeamPageIndexEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then((h) => { if (!cancelled) setVersion(h.version); })
      .catch(() => { /* version footer is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  // For a scoped viewer, load the (server-scoped) team index so we can label
  // their own team link(s) by name. Admin/all-team viewers use the fixed nav.
  useEffect(() => {
    if (!scoped) {
      setScopedTeams([]);
      return;
    }
    let cancelled = false;
    api.views.teamsIndex()
      .then((rows) => { if (!cancelled) setScopedTeams(rows); })
      .catch(() => { /* nav is best-effort; Settings still works */ });
    return () => { cancelled = true; };
  }, [scoped]);

  return (
    <div className="app-shell">
      <nav className="nav-sidebar">
        <div className="nav-logo">
          <Link
            to={user ? landingPath(user) : '/'}
            className="nav-logo-head"
            aria-label="Go to home"
          >
            <span className="nav-logo-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="27" height="27" role="presentation" focusable="false">
                <defs>
                  <linearGradient id="navLogoMark" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stopColor="#4f46e5" />
                    <stop offset="0.52" stopColor="#7c3aed" />
                    <stop offset="1" stopColor="#22d3ee" />
                  </linearGradient>
                </defs>
                {/* AI "spark" mark in the aurora gradient — on-theme, crisp, no flat box. */}
                <path
                  fill="url(#navLogoMark)"
                  d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"
                />
                <path
                  fill="url(#navLogoMark)"
                  opacity="0.9"
                  d="M20 3l.63 1.9L22.5 5.5l-1.87.6L20 8l-.63-1.9L17.5 5.5l1.87-.6z"
                />
              </svg>
            </span>
            <span className="nav-logo-words">
              <span className="nav-logo-title">Adoption Tracker</span>
              {version && <span className="nav-logo-version">v{version}</span>}
            </span>
          </Link>
        </div>
        {scoped ? (
          // Scoped viewer (champion): only their own team, on the id-less
          // /ai_adoption route (no team id ever exposed in the URL).
          <div className="nav-section stagger-children">
            <div className="nav-section-label">My team</div>
            {scopedTeams.length === 1 || scopedTeams.length === 0 ? (
              <NavLink to="/ai_adoption" className={navClass}>
                <NavIcon><PeopleIconPaths /></NavIcon> {scopedTeams[0]?.team_name ?? 'My team'}
              </NavLink>
            ) : (
              // Defensive: a scoped viewer with >1 team isn't a champion; keep
              // per-team id links so each is still reachable.
              scopedTeams.map((t) => (
                <NavLink key={t.team_id} to={`/teams/${t.team_id}`} className={navClass}>
                  <NavIcon><PeopleIconPaths /></NavIcon> {t.team_name}
                </NavLink>
              ))
            )}
          </div>
        ) : (
          <>
            <div className="nav-section stagger-children">
              <div className="nav-section-label">Main</div>
              {/* New Report is admin-only (report creation is not a viewer action). */}
              {isAdmin && (
                <NavLink to="/reports/new" className={navClass}>
                  <NavIcon>
                    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
                    <path d="M12 11v6" />
                    <path d="M9 14h6" />
                  </NavIcon> New Report
                </NavLink>
              )}
              <NavLink to="/" end className={navClass}>
                <NavIcon><PeopleIconPaths /></NavIcon> Teams
              </NavLink>
              <NavLink to="/artifacts" className={navClass}>
                <NavIcon>
                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                  <path d="m3.3 7 8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </NavIcon> Artifacts
              </NavLink>
              <NavLink to="/tasks" className={navClass}>
                <NavIcon>
                  <path d="m3 17 2 2 4-4" />
                  <path d="m3 7 2 2 4-4" />
                  <path d="M13 6h8" />
                  <path d="M13 12h8" />
                  <path d="M13 18h8" />
                </NavIcon> Tasks
              </NavLink>
              <NavLink to="/ai-lead" className={navClass}>
                <NavIcon>
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </NavIcon> AI Lead
              </NavLink>
            </div>
            {/* Admin-only management surfaces. */}
            {isAdmin && (
              <>
                <hr className="nav-divider" />
                <div className="nav-section stagger-children">
                  <NavLink to="/manage" className={navClass}>
                    <NavIcon>
                      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                      <circle cx="12" cy="12" r="3" />
                    </NavIcon> Manage
                  </NavLink>
                  <NavLink to="/users" className={navClass}>
                    <NavIcon><PeopleIconPaths /></NavIcon> Users
                  </NavLink>
                </div>
              </>
            )}
          </>
        )}
      </nav>

      {/* Top-right shell cluster, pinned above every page's sticky .top-bar:
          [ theme toggle ] [ gap ] [ account avatar + menu ]. The reserved
          right-padding on .top-bar (--topbar-cluster) keeps page actions clear. */}
      <div className="account-cluster">
        <ThemeToggle />
        <SettingsMenu />
      </div>

      <div className="main-content anim-fade">
        <Outlet />
      </div>
    </div>
  );
}
