import { NavLink, Outlet } from "react-router-dom";
import { StaffShell } from "./StaffShell.js";
import { BrandMark } from "./BrandMark.js";
import { InstanceSidebarFoot } from "./InstanceSidebarFoot.js";

/** Instance-level admin layout for the events picker (/admin), users (/admin/users), and account (/account). */
export function EventsListShell() {
  const sidebar = (
    <>
      <NavLink to="/admin" className="sidebar__brand" end>
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

