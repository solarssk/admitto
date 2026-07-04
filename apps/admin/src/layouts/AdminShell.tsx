import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin, isAdmin } from "../auth/capabilities.js";
import type { EventDto } from "../api/types.js";
import type { RoleAssignment } from "../api/types.js";
import { StaffShell } from "./StaffShell.js";
import { formatEventCalendarDate } from "../utils/event-dates.js";

type NavItem = {
  segment: string;
  icon: string;
  label: string;
};

// Segments outside LIVE_SEGMENTS render as plain disabled items — no release
// labels or "Soon" badges in the UI, they drift out of date (#263).
const LIFECYCLE_NAV: NavItem[] = [
  { segment: "overview", icon: "layout-dashboard", label: "Overview" },
  { segment: "attendees", icon: "users", label: "Attendees" },
  { segment: "requirements", icon: "clipboard-list", label: "Requirements" },
  { segment: "approval", icon: "user-check", label: "Approval" },
  { segment: "communication", icon: "mail", label: "Communication" },
  { segment: "checkin", icon: "qrcode", label: "Check-in" },
  { segment: "wallet", icon: "wallet", label: "Passes" },
  { segment: "fulfilment", icon: "package", label: "Fulfilment" },
  { segment: "thank-you", icon: "heart", label: "Post-event" },
  { segment: "reports", icon: "chart-bar", label: "Reports" },
  { segment: "settings", icon: "adjustments", label: "Event settings" },
];

const LIVE_SEGMENTS = new Set([
  "overview",
  "attendees",
  "requirements",
  "communication",
  "checkin",
  "reports",
  "settings",
]);

/** Format event date and optional location for the sidebar event switcher. */
function formatEventMeta(event: EventDto): string {
  const date = formatEventCalendarDate(event.date);
  return event.location ? `${date} · ${event.location}` : date;
}

export interface AdminShellProps {
  event: EventDto;
}

const BRAND_MARK = (
  <svg className="sidebar__brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="30" height="30" rx="7.5" fill="#066fd1" />
    <path d="M9.5 16.5l4.2 4.2 7.5-9" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="22.5" y="6" width="4" height="4" rx="1" fill="#ffffff" fillOpacity="0.55" />
  </svg>
);

/** Administration links rendered in the sidebar foot for admin+ users. */
function administrationFoot(assignments: RoleAssignment[]) {
  if (!isAdmin(assignments)) return null;
  return (
    <>
      <div className="sidebar__section-label">Administration</div>
      <NavLink
        to="/admin/users"
        className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
      >
        <i className="ti ti-users-group" aria-hidden="true" />
        <span>Users & roles</span>
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
    </>
  );
}

/** Event-scoped admin layout: lifecycle sidebar, top bar, and nested route outlet. */
export function AdminShell({ event }: AdminShellProps) {
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
            >
              <i className={`ti ti-${item.icon}`} aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar__foot">
        <NavLink to="/admin" className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
          <i className="ti ti-calendar-event" aria-hidden="true" />
          <span>All events</span>
        </NavLink>
        {administrationFoot(assignments)}
      </div>
    </>
  );

  return (
    <StaffShell sidebar={sidebar}>
      <Outlet context={{ event }} />
    </StaffShell>
  );
}
