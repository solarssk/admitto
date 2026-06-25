import { NavLink, Outlet } from "react-router-dom";
import { canAccessAdminPanel } from "../auth/capabilities.js";
import { useAuth } from "../auth/AuthProvider.js";
import { StaffShell } from "./StaffShell.js";

const BRAND_MARK = (
  <svg className="sidebar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1" />
    <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55" />
  </svg>
);

/** Shell for /account — shared by admin and operator staff. */
export function AccountShell() {
  const { assignments } = useAuth();
  const backTo = canAccessAdminPanel(assignments) ? "/admin" : "/operator";
  const backLabel = canAccessAdminPanel(assignments) ? "All events" : "Check-in";

  const sidebar = (
    <>
      <NavLink to={backTo} className="sidebar__brand">
        {BRAND_MARK}
        <span>Admitto</span>
      </NavLink>
      <div className="sidebar__nav" aria-hidden="true" />
      <div className="sidebar__foot">
        <NavLink to={backTo} className="nav-item">
          <i className={`ti ti-${canAccessAdminPanel(assignments) ? "calendar-event" : "scan"}`} aria-hidden="true" />
          <span>{backLabel}</span>
        </NavLink>
        <NavLink
          to="/account"
          className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
          end
        >
          <i className="ti ti-user-circle" aria-hidden="true" />
          <span>My account</span>
        </NavLink>
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar}>
      <Outlet />
    </StaffShell>
  );
}
