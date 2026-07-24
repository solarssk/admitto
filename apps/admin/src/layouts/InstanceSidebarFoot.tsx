import { NavLink } from "react-router";
import {
  canAccessAdminPanel,
  canAccessCheckInPanel,
  isAdmin,
  isSuperadmin,
} from "../auth/capabilities.js";
import { useAuth } from "../auth/AuthProvider.js";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `nav-item${isActive ? " nav-item--active" : ""}`;

/** Sidebar footer shared by all instance-level shells (/admin, /admin/users, /admin/settings, /account). */
export function InstanceSidebarFoot({ omitPrimary = false }: Readonly<{ omitPrimary?: boolean }>) {
  const { assignments } = useAuth();
  const canAdmin = canAccessAdminPanel(assignments);
  const canCheckIn = canAccessCheckInPanel(assignments);

  const checkInLink = canCheckIn ? (
    <NavLink to="/operator" className={navClass}>
      <i className="ti ti-qrcode" aria-hidden="true" />
      <span>Check-in</span>
    </NavLink>
  ) : null;
  const primaryLink = canAdmin ? (
    <NavLink to="/admin" className={navClass} end>
      <i className="ti ti-calendar-event" aria-hidden="true" />
      <span>All events</span>
    </NavLink>
  ) : (
    checkInLink
  );

  return (
    <>
      {!omitPrimary && primaryLink}
      {isAdmin(assignments) && (
        <>
          <div className="sidebar__section-label">Administration</div>
          <NavLink to="/admin/users" className={navClass}>
            <i className="ti ti-users-group" aria-hidden="true" />
            <span>Users & roles</span>
          </NavLink>
          {isSuperadmin(assignments) && (
            <NavLink to="/admin/settings" className={navClass}>
              <i className="ti ti-settings" aria-hidden="true" />
              <span>Settings</span>
            </NavLink>
          )}
        </>
      )}
      <NavLink to="/account" className={navClass}>
        <i className="ti ti-user-circle" aria-hidden="true" />
        <span>My account</span>
      </NavLink>
      <a
        href="https://github.com/solarssk/admitto/wiki"
        target="_blank"
        rel="noopener noreferrer"
        className="nav-item"
      >
        <i className="ti ti-book" aria-hidden="true" />
        <span>Documentation</span>
      </a>
      <div className="sidebar__version">v{__APP_VERSION__}</div>
    </>
  );
}
