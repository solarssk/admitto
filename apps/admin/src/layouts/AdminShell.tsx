import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Badge, Button } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import type { EventDto } from "../api/types.js";
import { StaffShell } from "./StaffShell.js";

const LIFECYCLE_NAV = [
  { segment: "overview", icon: "layout-dashboard", label: "Overview" },
  { segment: "attendees", icon: "users", label: "Attendees" },
  { segment: "requirements", icon: "clipboard-list", label: "Requirements" },
  { segment: "approval", icon: "user-check", label: "Approval" },
  { segment: "communication", icon: "mail", label: "Communication" },
  { segment: "wallet", icon: "wallet", label: "Wallet" },
  { segment: "checkin", icon: "qrcode", label: "Check-in" },
  { segment: "fulfilment", icon: "package", label: "Fulfilment" },
  { segment: "thank-you", icon: "heart", label: "Thank you" },
  { segment: "reports", icon: "chart-bar", label: "Reports" },
] as const;

const LIVE_SEGMENTS = new Set(["overview", "attendees", "requirements", "communication", "checkin"]);

/** Format event date and optional location for the sidebar event switcher. */
function formatEventMeta(event: EventDto): string {
  const date = new Date(event.date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return event.location ? `${date} · ${event.location}` : date;
}

export interface AdminShellProps {
  event: EventDto;
  showArchiveButton?: boolean;
  onArchiveRequest?: () => void;
}

const BRAND_MARK = (
  <svg className="sidebar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1" />
    <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55" />
  </svg>
);

/** Event-scoped admin layout: lifecycle sidebar, top bar, and nested route outlet. */
export function AdminShell({ event, showArchiveButton, onArchiveRequest }: AdminShellProps) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { assignments } = useAuth();

  const sidebar = (
    <>
      <NavLink to="/admin" className="sidebar__brand" end>
        {BRAND_MARK}
        <span>Admitto</span>
      </NavLink>
      <div className="sidebar__event">
        <div className="overline">Event</div>
        <button type="button" className="event-switch" onClick={() => navigate("/admin")}>
          <span>{event.title}</span>
          <i className="ti ti-selector" aria-hidden="true" />
        </button>
        <div className="event-switch__meta">{formatEventMeta(event)}</div>
      </div>
      <nav className="sidebar__nav" aria-label="Event lifecycle">
        {LIFECYCLE_NAV.map((item) => {
          const to = `/admin/events/${eventId}/${item.segment}`;
          const isLive = LIVE_SEGMENTS.has(item.segment);
          return isLive ? (
            <NavLink
              key={item.segment}
              to={to}
              className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
              end={item.segment === "overview"}
            >
              <i className={`ti ti-${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          ) : (
            <button
              key={item.segment}
              type="button"
              disabled
              className="nav-item nav-item--soon"
              title="Coming soon"
            >
              <i className={`ti ti-${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
              <span className="nav-item__badge">Soon</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar__foot">
        <NavLink to="/admin" className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
          <i className="ti ti-calendar-event" aria-hidden="true" />
          <span>All events</span>
        </NavLink>
        {isSuperadmin(assignments) && (
          <NavLink
            to="/admin/settings"
            className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
          >
            <i className="ti ti-settings" aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
        )}
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar}>
      {(showArchiveButton && onArchiveRequest) || event.archived_at ? (
        <div className="event-archive-bar">
          {event.archived_at && <Badge variant="neutral">Archived</Badge>}
          {showArchiveButton && onArchiveRequest && (
            <Button type="button" variant="secondary" onClick={onArchiveRequest}>
              Archive event
            </Button>
          )}
        </div>
      ) : null}
      <Outlet context={{ event }} />
    </StaffShell>
  );
}
