import { Link } from "react-router-dom";
import { useCallback, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { MailerStatusBadge } from "../components/MailerStatusBadge.js";
import { RoleBadge } from "../components/RoleBadge.js";

export interface StaffShellProps {
  sidebar: ReactNode;
  /** Optional horizontal section nav — scrolls with page content. */
  subnav?: ReactNode;
  children: ReactNode;
}

const SIDEBAR_PIN_KEY = "admitto_sidebar_pinned";

function readPinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PIN_KEY) !== "false";
  } catch {
    return true;
  }
}

/** App shell: fixed sidebar + topbar chrome, scrollable main content area. */
export function StaffShell({ sidebar, subnav, children }: StaffShellProps) {
  const { user, assignments } = useAuth();
  const displayName = user.display_name || user.email.split("@")[0] || "Staff";
  const [navOpen, setNavOpen] = useState(false);
  const [pinned, setPinned] = useState(readPinned);
  const [hovered, setHovered] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(SIDEBAR_PIN_KEY, String(next));
    } catch {
      /* ignore storage errors */
    }
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
            <MailerStatusBadge status={user.mailer_status} />
            <div className="topbar__user">
              <Link to="/account" className="topbar__user-link">
                <RoleBadge assignments={assignments} />
                <span className="topbar__user-name">{displayName}</span>
              </Link>
            </div>
            <form method="post" action="/logout">
              <button
                type="submit"
                className="topbar__signout"
                aria-label="Sign out"
                title="Sign out"
              >
                <i className="ti ti-logout" aria-hidden="true" />
              </button>
            </form>
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
