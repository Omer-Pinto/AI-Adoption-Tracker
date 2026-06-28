import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '@/api';
import type { TaskStatus } from '@/types';

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
          <div className="nav-logo-title">Adoption Tracker</div>
          <div className="nav-logo-sub">AI Adoption Journal</div>
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
        {version && <div className="nav-version">v{version}</div>}
      </nav>

      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}
