import { Link, useOutletContext } from "react-router-dom";
import { Badge, Card, PageHeader, Stat } from "@admitto/ui";
import type { EventDto } from "../api/types.js";
import { formatEventDate, formatEventDateTime } from "../utils/event-dates.js";

const QUICK_LINKS = [
  { segment: "attendees", icon: "users", label: "Attendees", desc: "Guest list, import, and export" },
  { segment: "requirements", icon: "clipboard-list", label: "Requirements", desc: "Registration rules and fields" },
  { segment: "communication", icon: "mail", label: "Communication", desc: "Ticket and lifecycle mail" },
  { segment: "checkin", icon: "qrcode", label: "Check-in", desc: "Door scanning and admission" },
] as const;

/** Event-scoped home — metrics and shortcuts after picking an event. */
export function EventOverviewPage() {
  const { event } = useOutletContext<{ event: EventDto }>();
  const meta = [formatEventDate(event.date), event.location].filter(Boolean).join(" · ");

  return (
    <div className="screen">
      <PageHeader
        title={event.title}
        subtitle={meta ? `${meta} — event overview` : "Event overview"}
        actions={
          event.archived_at ? <Badge variant="neutral">Archived · read-only</Badge> : undefined
        }
      />

      <div className="overview-stats">
        <Card>
          <Stat label="Attendees" value={event.attendee_count ?? "—"} sub="Registered guests" />
        </Card>
        <Card>
          <Stat label="Status" value={event.archived_at ? "Archived" : "Active"} sub="Lifecycle state" />
        </Card>
      </div>

      {event.archived_at && (
        <p className="overview-archived-note">
          Archived on {formatEventDateTime(event.archived_at)}. Restore from the events list if you need to edit
          again.
        </p>
      )}

      <section className="overview-section">
        <h2 className="overview-section__title">Quick actions</h2>
        <div className="overview-links">
          {QUICK_LINKS.map((item) => (
            <Link
              key={item.segment}
              to={`/admin/events/${event.id}/${item.segment}`}
              className="overview-link-card"
            >
              <i className={`ti ti-${item.icon}`} aria-hidden="true" />
              <span className="overview-link-card__text">
                <strong>{item.label}</strong>
                <span>{item.desc}</span>
              </span>
              <i className="ti ti-chevron-right overview-link-card__chevron" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
