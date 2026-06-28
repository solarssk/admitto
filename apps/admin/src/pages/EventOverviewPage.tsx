import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Badge, Card, PageHeader, Stat } from "@admitto/ui";
import { ApiError, fetchEventOverview } from "../api/client.js";
import type { EventDto, EventOverviewDto } from "../api/types.js";
import { formatEventDate, formatEventDateTime } from "../utils/event-dates.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";

function computeLabel(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const absMs = Math.abs(diff);
  const days = Math.floor(absMs / 86_400_000);
  const hours = Math.floor((absMs % 86_400_000) / 3_600_000);
  if (diff < 0) {
    if (days === 0) return "Ended today";
    if (days === 1) return "Ended yesterday";
    return `Ended ${days} days ago`;
  }
  if (days === 0 && hours === 0) return "Starting soon";
  if (days === 0) return `Today in ${hours}h`;
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `In ${days} days`;
  return `In ${days} days`;
}

function useCountdown(targetDateIso: string | null): string {
  const [label, setLabel] = useState<string>(() => computeLabel(targetDateIso));

  useEffect(() => {
    if (!targetDateIso) return;
    const tick = () => setLabel(computeLabel(targetDateIso));
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [targetDateIso]);

  return label;
}

function AdmissionBar({ admitted, total }: { admitted: number; total: number }) {
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;
  return (
    <div
      className="overview-admission-bar"
      role="progressbar"
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

  const countdown = useCountdown(overview?.event.date ?? event.date);

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);

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

  const meta = [formatEventDate(event.date), event.location].filter(Boolean).join(" · ");

  const attendeeCount = overview?.attendee_count ?? event.attendee_count ?? null;
  const admittedCount = overview?.admitted_count ?? null;
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
              overview?.event.capacity != null
                ? `of ${overview.event.capacity} capacity`
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
            value={overview != null ? String(overview.email_sent) : loading ? "…" : "—"}
            sub={
              overview?.email_failed
                ? `${overview.email_failed} failed`
                : overview?.email_queued
                  ? `${overview.email_queued} queued`
                  : "Delivered"
            }
          />
        </Card>
        <Card>
          <Stat label="Event date" value={countdown} sub={formatEventDate(event.date)} />
        </Card>
      </div>

      {error && <p className="text-error">{error}</p>}

      {event.archived_at && (
        <p className="overview-archived-note">
          Archived on {formatEventDateTime(event.archived_at)}. Restore from event settings if you need to edit
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
