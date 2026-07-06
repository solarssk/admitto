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

/** Instance-level admin layout for the events picker (/admin), users (/admin/users), and account (/account). */
export function EventsListShell() {
  const { assignments } = useAuth();
  const brandTo = brandHomeTo(assignments);

  const sidebar = (
    <>
      <NavLink to={brandTo} className="sidebar__brand" end={brandTo === "/admin"}>
        {BrandMark}
        <span>Admitto</span>
      </NavLink>
      <div className="sidebar__nav" aria-hidden="true" />
      <div className="sidebar__foot">
        <InstanceSidebarFoot />
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar}>
      <Outlet />
    </StaffShell>
  );
}
