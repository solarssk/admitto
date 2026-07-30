import { NavLink } from "react-router";
import { isAdmin, isSuperadmin } from "../auth/capabilities.js";
import { useAuth } from "../auth/AuthProvider.js";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `nav-item${isActive ? " nav-item--active" : ""}`;

/** Sidebar footer shared by all instance-level shells (/admin, /admin/users, /admin/settings, /account).
 * No "back to events list" / "back to check-in list" link here — the brand mark above already
 * links home for every role (see BrandLink usages in each shell), so a second nav item pointing
 * to the same place would just duplicate it. */
export function InstanceSidebarFoot() {
  const { assignments } = useAuth();

  return (
    <>
      {isAdmin(assignments) && (
        <>
          <div className="sidebar__section-label">
            <span className="sidebar__section-label-text">Administration</span>
          </div>
          <NavLink to="/admin/users" className={navClass}>
            <i className="ti ti-users-group" aria-hidden="true" />
            <span>Users & roles</span>
          </NavLink>
          {isSuperadmin(assignments) && (
            <NavLink to="/admin/settings" className={navClass}>
              <i className="ti ti-settings" aria-hidden="true" />
              <span>Organisation settings</span>
            </NavLink>
          )}
        </>
      )}
      <div className="sidebar__build">
        <span className="sidebar__build-ver">v{__APP_VERSION__}</span>
        <a
          href="https://github.com/solarssk/admitto/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="sidebar__build-report"
          title="Report a bug"
          aria-label="Report a bug"
        >
          <i className="ti ti-bug" aria-hidden="true" />
        </a>
      </div>
    </>
  );
}
