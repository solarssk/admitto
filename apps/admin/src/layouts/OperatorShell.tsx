import { useEffect, useState } from "react";
import { NavLink, Outlet, useParams } from "react-router";
import { ConnectionBanner } from "../connection/ConnectionStateProvider.js";
import { StaffShell } from "./StaffShell.js";
import { BrandLink } from "./BrandLink.js";
import { InstanceSidebarFoot } from "./InstanceSidebarFoot.js";
import { fetchCheckInEvents } from "../api/client.js";
import { formatEventCalendarDate } from "../utils/event-dates.js";
import type { EventDto } from "../api/types.js";

function OperatorSidebar() {
  const { eventId } = useParams();
  const [event, setEvent] = useState<EventDto | null>(null);

  useEffect(() => {
    if (!eventId) { setEvent(null); return; }
    let cancelled = false;
    void fetchCheckInEvents()
      .then((events) => { if (!cancelled) setEvent(events.find((e) => e.id === eventId) ?? null); })
      .catch(() => { if (!cancelled) setEvent(null); });
    return () => { cancelled = true; };
  }, [eventId]);

  return (
    <>
      <BrandLink to="/operator" end className="sidebar__brand" />
      {event && (
        <div className="sidebar__event">
          <div className="overline">Event</div>
          <div className="sidebar__event-info">
            <strong className="sidebar__event-title">{event.title}</strong>
            <div className="sidebar__event-detail">
              <i className="ti ti-calendar" aria-hidden="true" />
              <span>{formatEventCalendarDate(event.date)}</span>
            </div>
            {event.location && (
              <div className="sidebar__event-detail">
                <i className="ti ti-map-pin" aria-hidden="true" />
                <span>{event.location}</span>
              </div>
            )}
          </div>
        </div>
      )}
      <nav className="sidebar__nav" aria-label="Navigation">
        {eventId && (
          <NavLink
            to={`/operator/events/${eventId}/checkin`}
            className={({ isActive }: { isActive: boolean }) => `nav-item${isActive ? " nav-item--active" : ""}`}
          >
            <i className="ti ti-qrcode" aria-hidden="true" />
            <span>Check-in</span>
          </NavLink>
        )}
      </nav>
      <div className="sidebar__foot">
        <InstanceSidebarFoot />
      </div>
    </>
  );
}

export function OperatorShell() {
  const { eventId } = useParams();
  const onCheckInRoute = Boolean(eventId);

  return (
    <StaffShell sidebar={<OperatorSidebar />} eventId={eventId} brandTo="/operator" brandEnd>
      {!onCheckInRoute && <ConnectionBanner />}
      <Outlet />
    </StaffShell>
  );
}
