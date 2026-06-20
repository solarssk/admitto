import { NavLink, Outlet } from "react-router-dom";
import { Avatar } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";

/** Admin layout for the events picker (/admin) before an event is selected. */
export function EventsListShell() {
  const { user, assignments } = useAuth();
  const displayName = user.display_name || user.email.split("@")[0] || "Staff";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true" />
          <span>Admitto</span>
        </div>
        <div className="sidebar__event">
          <div className="overline">Admin</div>
          <div className="sidebar__context-meta">Select an event to manage</div>
        </div>
        <div className="sidebar__foot">
          <NavLink to="/admin" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>All events</span>
          </NavLink>
          {isSuperadmin(assignments) && (
            <>
              <NavLink
                to="/admin/settings"
                className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`}
                end
              >
                <i className="ti ti-settings" aria-hidden="true" />
                <span>Instance settings</span>
              </NavLink>
              <a className="nav-item" href="/admin/auth/providers">
                <i className="ti ti-key" aria-hidden="true" />
                <span>Identity providers</span>
              </a>
              <a className="nav-item" href="/admin/auth/cf-access">
                <i className="ti ti-shield-lock" aria-hidden="true" />
                <span>Cloudflare Access</span>
              </a>
            </>
          )}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__title">Events</div>
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
