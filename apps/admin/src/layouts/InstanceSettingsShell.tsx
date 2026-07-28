import { Outlet } from "react-router";
import { StaffShell } from "./StaffShell.js";
import { BrandLink } from "./BrandLink.js";
import { InstanceSidebarFoot } from "./InstanceSidebarFoot.js";

/** Instance-scoped admin layout for superadmin settings (/admin/settings/*). */
export function InstanceSettingsShell() {
  const sidebar = (
    <>
      <BrandLink to="/admin" end className="sidebar__brand" />
      <div className="sidebar__nav" aria-hidden="true" />
      <div className="sidebar__foot">
        <InstanceSidebarFoot />
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar} brandTo="/admin" brandEnd>
      <Outlet />
    </StaffShell>
  );
}

