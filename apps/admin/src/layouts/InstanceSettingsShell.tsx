import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Avatar } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";

/** Layout shell for instance-level settings (no event context). */
export function InstanceSettingsShell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const displayName = user.display_name || user.email.split("@")[0] || "Staff";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true" />
          <span>Admitto</span>
        </div>
        <nav className="sidebar__nav" aria-label="Instance settings">
          <NavLink
            to="/admin/settings"
            className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}
            end
          >
            <i className="ti ti-mail" aria-hidden="true" />
            <span>Mail transport</span>
          </NavLink>
        </nav>
        <div className="sidebar__foot">
          <button type="button" className="nav-item" onClick={() => navigate("/admin")}>
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>All events</span>
          </button>
          <a className="nav-item" href="/admin/auth/providers">
            <i className="ti ti-key" aria-hidden="true" />
            <span>Identity providers</span>
          </a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__title">Instance settings</div>
          <div className="topbar__right">
            <div className="topbar__user">
              <Avatar name={displayName} size="sm" />
              <span>{displayName}</span>
            </div>
            <form method="post" action="/logout">
              <button type="submit" className="topbar__signout">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
