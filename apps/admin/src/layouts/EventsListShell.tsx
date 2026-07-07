import { NavLink, Outlet } from "react-router-dom";
import type { RoleAssignment } from "../api/types.js";
import { canAccessAdminPanel, canAccessCheckInPanel } from "../auth/capabilities.js";
import { useAuth } from "../auth/AuthProvider.js";
import { StaffShell } from "./StaffShell.js";
import { BrandMark } from "./BrandMark.js";
import { InstanceSidebarFoot } from "./InstanceSidebarFoot.js";

function brandHomeTo(assignments: RoleAssignment[]): string {
  if (canAccessAdminPanel(assignments)) return "/admin";
  if (canAccessCheckInPanel(assignments)) return "/operator";
  return "/account";
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `nav-item${isActive ? " nav-item--active" : ""}`;

/** Instance-level admin layout for the events picker (/admin), users (/admin/users), and account (/account). */
export function EventsListShell() {
  const { assignments } = useAuth();
  const brandTo = brandHomeTo(assignments);
  const canAdmin = canAccessAdminPanel(assignments);
  const canCheckIn = canAccessCheckInPanel(assignments);
  const isOperatorOnly = canCheckIn && !canAdmin;

  const sidebar = (
    <>
      <NavLink to={brandTo} className="sidebar__brand" end={brandTo === "/admin"}>
        {BrandMark}
        <span>Admitto</span>
      </NavLink>
      <nav className="sidebar__nav" aria-label="Navigation">
        {isOperatorOnly && (
          <NavLink to="/operator" className={navClass}>
            <i className="ti ti-qrcode" aria-hidden="true" />
            <span>Check-in</span>
          </NavLink>
        )}
      </nav>
      <div className="sidebar__foot">
        <InstanceSidebarFoot omitPrimary={isOperatorOnly} />
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar}>
      <Outlet />
    </StaffShell>
  );
}
