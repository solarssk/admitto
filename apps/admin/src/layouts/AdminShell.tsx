import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Avatar, Badge } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import type { EventDto } from "../api/types.js";

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
}

export function AdminShell({ event }: AdminShellProps) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { user, assignments } = useAuth();
  const displayName = user.display_name || user.email.split("@")[0] || "Staff";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true" />
          <span>Admitto</span>
        </div>
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
            return (
              <NavLink
                key={item.segment}
                to={to}
                className={({ isActive }) =>
                  `nav-item${isActive ? " nav-item--active" : ""}${!isLive ? " nav-item--soon" : ""}`
                }
                end={item.segment === "overview"}
              >
                <i className={`ti ti-${item.icon}`} aria-hidden="true" />
                <span>{item.label}</span>
                {!isLive && <span className="nav-item__badge">Soon</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          <NavLink to="/admin" className={({ isActive }) => `nav-item${isActive ? " nav-item--active" : ""}`} end>
            <i className="ti ti-calendar-event" aria-hidden="true" />
            <span>All events</span>
          </NavLink>
          {isSuperadmin(assignments) && (
            <>
              <span className="nav-item nav-item--disabled" aria-disabled="true">
                <i className="ti ti-settings" aria-hidden="true" />
                <span>Instance settings</span>
                <span className="nav-item__badge">Soon</span>
              </span>
              <a className="nav-item" href="/admin/auth/providers">
                <i className="ti ti-key" aria-hidden="true" />
                <span>Identity providers</span>
              </a>
              <a className="nav-item" href="/admin/auth/cf-access">
                <i className="ti ti-shield-lock" aria-hidden="true" />
                <span>Cloudflare Access</span>
              </a>
            </>
          )}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar__title">{event.title}</div>
          <div className="topbar__right">
            <Badge variant="neutral">Foundation</Badge>
            <div className="topbar__user">
              <Avatar name={displayName} size="sm" />
              <span>{displayName}</span>
            </div>
            <form method="post" action="/logout">
              <button type="submit" className="topbar__signout">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
