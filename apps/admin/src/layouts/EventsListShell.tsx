import { Outlet } from "react-router";
import type { RoleAssignment } from "../api/types.js";
import { canAccessAdminPanel, canAccessCheckInPanel } from "../auth/capabilities.js";
import { useAuth } from "../auth/AuthProvider.js";
import { StaffShell } from "./StaffShell.js";
import { BrandLink } from "./BrandLink.js";
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
      <BrandLink to={brandTo} end={brandTo === "/admin"} className="sidebar__brand" />
      <nav className="sidebar__nav" aria-label="Navigation" />
      <div className="sidebar__foot">
        <InstanceSidebarFoot />
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar} brandTo={brandTo} brandEnd={brandTo === "/admin"}>
      <Outlet />
    </StaffShell>
  );
}
