import { NavLink, Outlet } from "react-router-dom";
import { isSuperadmin, isAdmin } from "../auth/capabilities.js";
import { useAuth } from "../auth/AuthProvider.js";
import { StaffShell } from "./StaffShell.js";

const BRAND_MARK = (
  <svg className="sidebar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1" />
    <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55" />
  </svg>
);

/** Admin layout for the events picker (/admin) before an event is selected. */
export function EventsListShell() {
  const { assignments } = useAuth();

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
        {isAdmin(assignments) && (
          <NavLink
            to="/admin/users"
            className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
          >
            <i className="ti ti-users-group" aria-hidden="true" />
            <span>Users & roles</span>
          </NavLink>
        )}
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
    </>
  );

  return (
    <StaffShell sidebar={sidebar}>
      <Outlet />
    </StaffShell>
  );
}
