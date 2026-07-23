import { useCallback, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { SystemStatus } from "../components/SystemStatus.js";
import { UserMenu } from "../components/UserMenu.js";
import { readSidebarPinned, writeSidebarPinned } from "./sidebarPinPref.js";

export interface StaffShellProps {
  sidebar: ReactNode;
  /** Optional horizontal section nav — scrolls with page content. */
  subnav?: ReactNode;
  children: ReactNode;
}

/** App shell: fixed sidebar + topbar chrome, scrollable main content area. */
export function StaffShell({ sidebar, subnav, children }: Readonly<StaffShellProps>) {
  const { user, assignments } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [pinned, setPinned] = useState(readSidebarPinned);
  const [hovered, setHovered] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    writeSidebarPinned(next);
  };

  const sidebarExpanded = pinned || hovered;

  return (
    <div
      className={[
        "shell",
        navOpen ? "shell--nav-open" : "",
        !pinned ? "shell--sidebar-unpinned" : "",
        sidebarExpanded ? "shell--sidebar-expanded" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="shell__backdrop"
        aria-label="Close navigation"
        tabIndex={navOpen ? 0 : -1}
        onClick={closeNav}
      />
      <aside
        className="sidebar"
        onClick={closeNav}
        onMouseEnter={() => !pinned && setHovered(true)}
        onMouseLeave={() => !pinned && setHovered(false)}
      >
        <button
          type="button"
          className="sidebar__close-btn"
          onClick={closeNav}
          aria-label="Close navigation"
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
        {sidebar}
        <button
          type="button"
          className="sidebar__pin-btn"
          onClick={(e) => {
            e.stopPropagation();
            togglePin();
          }}
          title={pinned ? "Unpin sidebar" : "Pin sidebar"}
          aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
        >
          <i className={`ti ti-${pinned ? "pin-filled" : "pin"}`} aria-hidden="true" />
        </button>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="topbar__menu"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <i className="ti ti-menu-2" aria-hidden="true" />
          </button>
          <div className="topbar__right">
            <SystemStatus assignments={assignments} mailerStatus={user.mailer_status} />
            <UserMenu user={user} assignments={assignments} />
          </div>
        </header>
        <div className="main-scroll">
          {subnav}
          <div className="content">{children}</div>
        </div>
      </div>
    </div>
  );
}
