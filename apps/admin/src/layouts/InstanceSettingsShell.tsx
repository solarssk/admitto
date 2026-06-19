import { NavLink, Outlet } from "react-router-dom";
import { Avatar, Badge } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";

/** Instance-scoped admin layout for superadmin settings (no event context). */
export function InstanceSettingsShell() {
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
          <div className="overline">Instance</div>
          <div className="event-switch__meta">System-wide configuration</div>
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
          <div className="topbar__title">Instance settings</div>
          <div className="topbar__right">
            <Badge variant="neutral">Foundation</Badge>
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
