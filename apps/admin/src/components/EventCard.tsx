import { Link } from "react-router";
import { Badge, Card } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { eventCardDateParts, eventCardStatus } from "../utils/event-card-status.js";

export interface EventCardProps {
  event: EventDto;
  href: string;
  touch?: boolean;
  showStatusBadge?: boolean;
  showAttendeeCount?: boolean;
}

/** Responsive column count for an `.event-grid` of event cards, shared by the
 * admin and operator pickers. Max two columns; cards need room for the map strip. */
export function eventGridClassName(count: number): string {
  if (count > 0) return "event-grid event-grid--cols-2";
  return "event-grid";
}

/** Event card shared by the admin (`/admin`) and operator (`/operator`) pickers.
 * `state={{ event }}` is a fast path only `EventLayout` (admin) reads on landing;
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

  const { month, day } = eventCardDateParts(event.date);
  const status = showStatusBadge ? eventCardStatus(event) : null;
  const mapSrc = event.map_preview_path?.trim() || null;
  const locationText = event.location?.trim() || null;
  const attendeeCount = event.attendee_count;

  return (
    <Link to={href} state={{ event }} className="event-card-link">
      <Card className={cardClassName} padded={false}>
        <div className="event-card__map">
          {mapSrc ? (
            <>
              <img
                className="event-card__map-img"
                src={mapSrc}
                alt=""
                loading="lazy"
                decoding="async"
              />
              {/* Nested <a> is illegal inside the card Link. List PNGs skip burn-in so the
                  pin stays centered under object-fit:cover; this HTML credit stays in frame. */}
              <span className="event-card__map-attribution">© OpenStreetMap</span>
            </>
          ) : (
            <div className="event-card__map-placeholder" aria-hidden="true">
              <i className="ti ti-map-off" />
              <span>No location</span>
            </div>
          )}
          <div className="event-card__weather" aria-label="Weather forecast coming soon">
            <i className="ti ti-cloud" aria-hidden="true" />
            <span>—°</span>
          </div>
        </div>

        <div className="event-card__body">
          <div className="event-card__date" aria-hidden="true">
            <span className="event-card__date-month">{month}</span>
            <span className="event-card__date-day">{day}</span>
          </div>

          <div className="event-card__main">
            {status && (
              <Badge variant={status.variant} outline={status.variant === "neutral"} className="event-card__status">
                {status.label}
              </Badge>
            )}
            <h2 className="event-card__title">{event.title}</h2>
            <p
              className={
                locationText
                  ? "event-card__location"
                  : "event-card__location event-card__location--empty"
              }
            >
              <i className="ti ti-map-pin" aria-hidden="true" />
              <span>{locationText ?? "No location set"}</span>
            </p>
          </div>
        </div>

        {showAttendeeCount && attendeeCount != null && (
          <div className="event-card__footer">
            <div className="event-card__stat">
              <i className="ti ti-users" aria-hidden="true" />
              <strong>{attendeeCount}</strong>
              <span>attendees</span>
            </div>
            {attendeeCount === 0 && (
              <span className="event-card__hint">Not imported yet</span>
            )}
          </div>
        )}
      </Card>
    </Link>
  );
}
