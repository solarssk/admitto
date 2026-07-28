import { useCallback, useState, type MouseEvent, type ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider.js";
import { SystemStatus } from "../components/SystemStatus.js";
import { UserMenu } from "../components/UserMenu.js";
import { BrandLink } from "./BrandLink.js";

export interface StaffShellProps {
  sidebar: ReactNode;
  /** Optional horizontal section nav — scrolls with page content. */
  subnav?: ReactNode;
  children: ReactNode;
  /** The event currently in view, if any — forwarded to SystemStatus so a superadmin's
   * Email sending row can reflect that event's own resolved mail transport. */
  eventId?: string;
  /** Href + NavLink `end` for the sidebar's own brand link, duplicated into the topbar
   * (mobile/tablet only, see .topbar__brand in shell.css) so the Admitto brand stays
   * visible while the drawer is closed (#454). */
  brandTo: string;
  brandEnd: boolean;
}

/** App shell: fixed sidebar + topbar chrome, scrollable main content area. */
export function StaffShell({
  sidebar,
  subnav,
  children,
  eventId,
  brandTo,
  brandEnd,
}: Readonly<StaffShellProps>) {
  const { user, assignments } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  const closeNav = useCallback(() => setNavOpen(false), []);

  // Auto-close only when the click actually navigates (an <a>, e.g. NavLink) — clicking
  // non-interactive sidebar area (event info block, section labels, whitespace) must not
  // dismiss the drawer. Keyboard users already have the dedicated close button + backdrop above.
  const closeNavOnLinkClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("a")) {
        closeNav();
      }
    },
    [closeNav],
  );

  return (
    <div className={`shell${navOpen ? " shell--nav-open" : ""}`}>
      <button
        type="button"
        className="shell__backdrop"
        aria-label="Close navigation"
        tabIndex={navOpen ? 0 : -1}
        onClick={closeNav}
      />
      <aside className="sidebar" onClick={closeNavOnLinkClick}>
        <button
          type="button"
          className="sidebar__close-btn"
          onClick={closeNav}
          aria-label="Close navigation"
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
        {sidebar}
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
          <BrandLink to={brandTo} end={brandEnd} className="topbar__brand" markClassName="topbar__brand-mark" />
          <div className="topbar__right">
            <SystemStatus assignments={assignments} mailerStatus={user.mailer_status} eventId={eventId} />
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
