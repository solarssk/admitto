import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Avatar } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";

const SETTINGS_TABS = [
  { label: "General", href: "/admin/settings" },
  { label: "Identity providers", href: "/admin/auth/providers" },
  { label: "Cloudflare Access", href: "/admin/auth/cf-access" },
] as const;

/** Instance-scoped admin layout for superadmin settings (no event context). */
export function InstanceSettingsShell() {
  const { user } = useAuth();
  const { pathname } = useLocation();
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
          <div className="overline">Instance</div>
          <div className="sidebar__context-meta">System-wide configuration</div>
        </div>
        <nav className="sidebar__nav" aria-label="Main" />
        <div className="sidebar__foot">
          <NavLink to="/admin" className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>All events</span>
          </NavLink>
          <a className="nav-item nav-item--active" href="/admin/settings">
            <i className="ti ti-settings" aria-hidden="true" />
            <span>Settings</span>
          </a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__title">Settings</div>
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
        <nav className="settings-subnav" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => (
            <a
              key={tab.href}
              href={tab.href}
              className={`settings-subnav__item${pathname === tab.href ? " settings-subnav__item--active" : ""}`}
            >
              {tab.label}
            </a>
          ))}
        </nav>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
