import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '@/api';
import { ThemeToggle } from './ThemeToggle';

// Sidebar + main-content shell, reusing the mvp/ look (.app-shell, .nav-sidebar).
// Nav: Teams → /, Artifacts → /artifacts, Tasks → /tasks, + Manage → /manage.
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

export function AppShell() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then((h) => { if (!cancelled) setVersion(h.version); })
      .catch(() => { /* version footer is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app-shell">
      <nav className="nav-sidebar">
        <div className="nav-logo">
          <div className="nav-logo-head">
          <span className="nav-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28" role="presentation" focusable="false">
              <defs>
                <linearGradient id="navLogoMark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#5b73f0" />
                  <stop offset="1" stopColor="#3a4fd0" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="8" fill="url(#navLogoMark)" />
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
            <span className="nav-logo-title">Adoption Tracker</span>
          </div>
          {version && <span className="nav-logo-version">v{version}</span>}
        </div>
        <div className="nav-section">
          <div className="nav-section-label">Main</div>
          <NavLink to="/reports/new" className={navClass}>
            <NavIcon>
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
              <path d="M12 11v6" />
              <path d="M9 14h6" />
            </NavIcon> New Report
          </NavLink>
          <NavLink to="/" end className={navClass}>
            <NavIcon>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </NavIcon> Teams
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
        <hr className="nav-divider" />
        <div className="nav-section">
          <NavLink to="/manage" className={navClass}>
            <NavIcon>
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
              <circle cx="12" cy="12" r="3" />
            </NavIcon> Manage
          </NavLink>
        </div>
        <div className="nav-foot">
          <ThemeToggle />
        </div>
      </nav>

      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}
