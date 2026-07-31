import { Link } from "react-router";
import { Badge, Card } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { formatEventCalendarDate } from "../utils/event-dates.js";

export interface EventCardProps {
  event: EventDto;
  href: string;
  touch?: boolean;
  showStatusBadge?: boolean;
  showAttendeeCount?: boolean;
}

/** Responsive column count for an `.event-grid` of event cards, shared by the
 * admin and operator pickers so both pages grow from 1 to 3 columns the same way. */
export function eventGridClassName(count: number): string {
  if (count >= 4) return "event-grid event-grid--cols-3";
  if (count > 0) return "event-grid event-grid--cols-2";
  return "event-grid";
}

/** Event card shared by the admin (`/admin`) and operator (`/operator`) pickers.
 * `state={{ event }}` is a fast path only `EventLayout` (admin) reads on landing —
 * harmless for operator, which never reads router state. */
export function EventCard({
  event,
  href,
  touch,
  showStatusBadge,
  showAttendeeCount,
}: Readonly<EventCardProps>) {
  const cardClassName = [
    "event-card",
    touch && "event-card--touch",
    event.archived_at && "event-card--archived",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link to={href} state={{ event }} className="event-card-link">
      <Card className={cardClassName}>
        {showStatusBadge && (
          <Badge
            variant={event.archived_at ? "neutral" : "ok"}
            className="event-card__status"
          >
            {event.archived_at ? "Archived" : "Active"}
          </Badge>
        )}
        <h2 className="event-card__title">{event.title}</h2>
        <p className="event-card__meta">
          <i className="ti ti-calendar" aria-hidden="true" />
          <span>{formatEventCalendarDate(event.date)}</span>
          {event.location && (
            <>
              <span aria-hidden="true">·</span>
              <i className="ti ti-map-pin" aria-hidden="true" />
              <span>{event.location}</span>
            </>
          )}
        </p>
        {showAttendeeCount && event.attendee_count != null && (
          <div className="event-card__stats">
            <div className="event-card__stat">
              <i className="ti ti-users" aria-hidden="true" />
              <strong>{event.attendee_count}</strong>
              <span>attendees</span>
            </div>
          </div>
        )}
      </Card>
    </Link>
  );
}
