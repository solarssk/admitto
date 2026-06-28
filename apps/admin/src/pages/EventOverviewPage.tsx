import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Badge, Card, PageHeader, Stat } from "@admitto/ui";
import { ApiError, fetchEventOverview } from "../api/client.js";
import type { EventDto, EventOverviewDto } from "../api/types.js";
import { formatEventDate, formatEventDateTime } from "../utils/event-dates.js";
import { useCountdown } from "../utils/event-countdown.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";

function AdmissionBar({ admitted, total }: { admitted: number; total: number }) {
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;
  return (
    <div
      className="overview-admission-bar"
      role="progressbar"
      aria-label="Admission progress"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="overview-admission-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

const QUICK_LINKS = [
  { segment: "attendees", icon: "users", label: "Attendees", desc: "Guest list, import, and export" },
  { segment: "requirements", icon: "clipboard-list", label: "Requirements", desc: "Registration rules and fields" },
  { segment: "communication", icon: "mail", label: "Communication", desc: "Ticket and lifecycle mail" },
  { segment: "checkin", icon: "qrcode", label: "Check-in", desc: "Door scanning and admission" },
  { segment: "reports", icon: "chart-bar", label: "Reports", desc: "Attendance stats and export" },
] as const;

/** Event-scoped dashboard — metrics, countdown, and shortcuts. */
export function EventOverviewPage() {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const abortRef = useRef<AbortController | null>(null);

  const [overview, setOverview] = useState<EventOverviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentOverview = overview?.event.id === event.id ? overview : null;
  const eventTimezone = currentOverview?.event.timezone ?? event.timezone;
  const eventDateIso = currentOverview?.event.date ?? event.date;
  const countdown = useCountdown(eventDateIso, eventTimezone);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    setOverview(null);

    fetchEventOverview(event.id, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        setOverview(data);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          setError("Failed to load event stats.");
        } else {
          setError("Failed to load event stats.");
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [event.id, reportApiError]);

  const meta = [formatEventDate(eventDateIso, eventTimezone), event.location]
    .filter(Boolean)
    .join(" · ");

  const attendeeCount = currentOverview?.attendee_count ?? event.attendee_count ?? null;
  const admittedCount = currentOverview?.admitted_count ?? null;
  const admitPct =
    attendeeCount != null && admittedCount != null && attendeeCount > 0
      ? Math.round((admittedCount / attendeeCount) * 100)
      : null;

  return (
    <div className="screen">
      <PageHeader
        title={event.title}
        subtitle={meta ? `${meta} · ${countdown}` : countdown}
        actions={event.archived_at ? <Badge variant="neutral">Archived · read-only</Badge> : undefined}
      />

      <div className="overview-stats">
        <Card>
          <Stat
            label="Attendees"
            value={attendeeCount != null ? String(attendeeCount) : "—"}
            sub={
              currentOverview?.event.capacity != null
                ? `of ${currentOverview.event.capacity} capacity`
                : "Registered"
            }
          />
        </Card>
        <Card>
          <Stat
            label="Admitted"
            value={admittedCount != null ? String(admittedCount) : loading ? "…" : "—"}
            sub={admitPct != null ? `${admitPct}% admission rate` : "Check-in stats"}
          />
          {admittedCount != null && attendeeCount != null && attendeeCount > 0 && (
            <AdmissionBar admitted={admittedCount} total={attendeeCount} />
          )}
        </Card>
        <Card>
          <Stat
            label="Emails sent"
            value={currentOverview != null ? String(currentOverview.email_sent) : loading ? "…" : "—"}
            sub={
              currentOverview == null
                ? loading
                  ? "Loading delivery stats"
                  : "Delivery stats unavailable"
                : currentOverview.email_failed
                  ? `${currentOverview.email_failed} failed`
                  : currentOverview.email_queued
                    ? `${currentOverview.email_queued} queued`
                    : "Delivered"
            }
          />
        </Card>
        <Card>
          <Stat
            label="Event date"
            value={countdown}
            sub={formatEventDate(eventDateIso, eventTimezone)}
          />
        </Card>
      </div>

      {error && <p className="text-error">{error}</p>}

      {event.archived_at && (
        <p className="overview-archived-note">
          Archived on {formatEventDateTime(event.archived_at, eventTimezone)}. Restore from event
          settings if you need to edit again.
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
