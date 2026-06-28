import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '@/api';
import type { TaskStatus } from '@/types';
import { ThemeToggle } from './ThemeToggle';

// Open = AI-Lead action items not in the terminal/closed status set.
const CLOSED_STATUSES = new Set<TaskStatus>([
  'finished_successfully',
  'finished_with_issues',
  'abandoned',
  'wont_fix',
]);

// Sidebar + main-content shell, reusing the mvp/ look (.app-shell, .nav-sidebar).
// Nav: Teams → /, Artifacts → /artifacts, Tasks → /tasks, + Manage → /manage.
// Routed pages render in the <Outlet/>.

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'nav-item active' : 'nav-item';
}

export function AppShell() {
  const [aiLeadOpen, setAiLeadOpen] = useState(0);
  const [version, setVersion] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.aiLead
      .actionItems()
      .then((items) => {
        if (!cancelled) {
          setAiLeadOpen(items.filter((it) => !CLOSED_STATUSES.has(it.status)).length);
        }
      })
      .catch(() => { /* badge is best-effort; ignore load failures */ });
    api.health()
      .then((h) => { if (!cancelled) setVersion(h.version); })
      .catch(() => { /* version footer is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app-shell">
      <nav className="nav-sidebar">
        <div className="nav-logo">
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
          <div className="nav-logo-lockup">
            <span className="nav-logo-title">Adoption Tracker</span>
            {version && <span className="nav-logo-version">v{version}</span>}
          </div>
        </div>
        <div className="nav-section">
          <div className="nav-section-label">Main</div>
          <NavLink to="/reports/new" className={navClass}>
            <span className="nav-icon">&#43;</span> New Report
          </NavLink>
          <NavLink to="/" end className={navClass}>
            <span className="nav-icon">&#9632;</span> Teams
          </NavLink>
          <NavLink to="/artifacts" className={navClass}>
            <span className="nav-icon">&#9679;</span> Artifacts
          </NavLink>
          <NavLink to="/tasks" className={navClass}>
            <span className="nav-icon">&#10003;</span> Tasks
          </NavLink>
          <NavLink to="/ai-lead" className={navClass}>
            <span className="nav-icon">&#9733;</span> AI Lead
            {aiLeadOpen > 0 && <span className="nav-badge">{aiLeadOpen}</span>}
          </NavLink>
        </div>
        <hr className="nav-divider" />
        <div className="nav-section">
          <NavLink to="/manage" className={navClass}>
            <span className="nav-icon">&#9881;</span> Manage
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
