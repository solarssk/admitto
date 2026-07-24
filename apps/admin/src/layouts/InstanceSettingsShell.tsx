import { NavLink, Outlet } from "react-router";
import { StaffShell } from "./StaffShell.js";
import { BrandMark } from "./BrandMark.js";
import { InstanceSidebarFoot } from "./InstanceSidebarFoot.js";

/** Instance-scoped admin layout for superadmin settings (/admin/settings/*). */
export function InstanceSettingsShell() {
  const sidebar = (
    <>
      <NavLink to="/admin" className="sidebar__brand" end>
        <BrandMark />
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

