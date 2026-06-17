import { NavLink, Outlet } from 'react-router-dom';

// Sidebar + main-content shell, reusing the mvp/ look (.app-shell, .nav-sidebar).
// Nav: Teams → /, Artifacts → /artifacts, Tasks → /tasks, + Manage → /manage.
// Routed pages render in the <Outlet/>.

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'nav-item active' : 'nav-item';
}

export function AppShell() {
  return (
    <div className="app-shell">
      <nav className="nav-sidebar">
        <div className="nav-logo">
          <div className="nav-logo-title">Adoption Tracker</div>
          <div className="nav-logo-sub">AI Adoption Journal</div>
        </div>
        <div className="nav-section">
          <div className="nav-section-label">Main</div>
          <NavLink to="/" end className={navClass}>
            <span className="nav-icon">&#9632;</span> Teams
          </NavLink>
          <NavLink to="/artifacts" className={navClass}>
            <span className="nav-icon">&#9679;</span> Artifacts
          </NavLink>
          <NavLink to="/tasks" className={navClass}>
            <span className="nav-icon">&#10003;</span> Tasks
          </NavLink>
        </div>
        <hr className="nav-divider" />
        <div className="nav-section">
          <NavLink to="/manage" className={navClass}>
            <span className="nav-icon">&#9881;</span> Manage
          </NavLink>
        </div>
      </nav>

      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}
