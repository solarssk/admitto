import { NavLink, Outlet, useLocation } from "react-router-dom";
import { isSettingsSubnavActive } from "./settings-nav.js";
import { StaffShell } from "./StaffShell.js";

const SETTINGS_TABS = [
  { label: "General", href: "/admin/settings" },
  { label: "Identity providers", href: "/admin/auth/providers" },
  { label: "Cloudflare Access", href: "/admin/auth/cf-access" },
] as const;

const BRAND_MARK = (
  <svg className="sidebar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1" />
    <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55" />
  </svg>
);

/** Instance-scoped admin layout for superadmin settings (no event context). */
export function InstanceSettingsShell() {
  const { pathname } = useLocation();
  const settingsActive =
    pathname.startsWith("/admin/settings") || pathname.startsWith("/admin/auth/");

  const sidebar = (
    <>
      <NavLink to="/admin" className="sidebar__brand" end>
        {BRAND_MARK}
        <span>Admitto</span>
      </NavLink>
      <div className="sidebar__nav" aria-hidden="true" />
      <div className="sidebar__foot">
        <NavLink to="/admin" className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
          <i className="ti ti-calendar-event" aria-hidden="true" />
          <span>All events</span>
        </NavLink>
        <NavLink
          to="/admin/settings"
          className={`nav-item${settingsActive ? " nav-item--active" : ""}`}
        >
          <i className="ti ti-settings" aria-hidden="true" />
          <span>Settings</span>
        </NavLink>
      </div>
    </>
  );

  const subnav = (
    <nav className="adm-subnav" aria-label="Settings sections">
      {SETTINGS_TABS.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          className={`adm-subnav-item${isSettingsSubnavActive(pathname, tab.href) ? " adm-subnav-item--active" : ""}`}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );

  return (
    <StaffShell sidebar={sidebar} subnav={subnav}>
      <Outlet />
    </StaffShell>
  );
}
