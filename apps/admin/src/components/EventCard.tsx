import { Link } from "react-router";
import { Badge, Card, Tooltip } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { eventCardDateParts, eventCardStatus } from "../utils/event-card-status.js";
import { weatherConditionLabel, weatherIconClass } from "../utils/weather-icon.js";

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

type WeatherChip = { label: string; tooltip: string; icon: string; text: string };

function weatherChip(event: EventDto): WeatherChip | null {
  const w = event.weather;
  if (!w) {
    if (event.has_coordinates === true) {
      return {
        label: "No weather",
        tooltip:
          "No forecast for this event. Weather may be off under Organisation settings > External services, or the event day is outside the provider horizon.",
        icon: "ti ti-cloud-off",
        text: "-°",
      };
    }
    return null;
  }
  if (w.status === "ok" && w.temp_c != null) {
    const condition = weatherConditionLabel(w.weather_code);
    const range =
      w.temp_min_c != null ? `${w.temp_min_c}° to ${w.temp_c}°C` : `${w.temp_c}°C`;
    const credit = w.attribution?.trim() || "Weather data";
    return {
      label: `Forecast ${w.temp_c}°C`,
      tooltip: `${condition}, ${range}.\n${credit}.`,
      icon: weatherIconClass(w.weather_code),
      text: `${w.temp_c}°`,
    };
  }
  if (w.status === "too_far") {
    const horizon = w.horizon_days ?? 0;
    const opensIn = w.opens_in_days ?? 0;
    const when =
      horizon > 0
        ? `Forecast available ${horizon} day${horizon === 1 ? "" : "s"} before the event`
        : "Forecast not available yet";
    const countdown =
      opensIn > 0
        ? ` Shows in about ${opensIn} day${opensIn === 1 ? "" : "s"}.`
        : "";
    return {
      label: when,
      tooltip: `${when}.${countdown}`,
      icon: "ti ti-cloud-question",
      text: "-°",
    };
  }
  if (w.status === "unavailable") {
    return {
      label: "Weather unavailable",
      tooltip:
        "Forecast could not be loaded. Check the weather provider under Organisation settings > External services (MET Norway needs Support contact for the API User-Agent).",
      icon: "ti ti-cloud-off",
      text: "-°",
    };
  }
  return null;
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
  const hasPin = event.has_coordinates === true;
  const locationText = event.location?.trim() || null;
  const attendeeCount = event.attendee_count;
  const mapPlaceholderLabel = hasPin && !mapSrc ? "Maps unavailable" : "No location";
  const mapAttribution = event.map_attribution?.trim() || "© OpenStreetMap";
  const weather = weatherChip(event);

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
              <span className="event-card__map-attribution">{mapAttribution}</span>
            </>
          ) : (
            <div className="event-card__map-placeholder" aria-hidden="true">
              <i className="ti ti-map-off" />
              <span>{mapPlaceholderLabel}</span>
            </div>
          )}
          {weather && (
            <Tooltip content={weather.tooltip} className="event-card__weather-tip">
              <div className="event-card__weather" aria-label={weather.label}>
                <i className={weather.icon} aria-hidden="true" />
                <span>{weather.text}</span>
              </div>
            </Tooltip>
          )}
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
