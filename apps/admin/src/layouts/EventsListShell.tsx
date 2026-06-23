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
          <svg className="sidebar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1"/>
            <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55"/>
          </svg>
          <span>Admitto</span>
        </div>
        <div className="sidebar__event">
          <div className="overline">Admin</div>
          <div className="sidebar__context-meta">Select an event to manage</div>
        </div>
        <nav className="sidebar__nav" aria-label="Main" />
        <div className="sidebar__foot">
          <NavLink to="/admin" className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>All events</span>
          </NavLink>
          {isSuperadmin(assignments) && (
            <NavLink
              to="/admin/settings"
              className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
            >
              <i className="ti ti-settings" aria-hidden="true" />
              <span>Settings</span>
            </NavLink>
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
