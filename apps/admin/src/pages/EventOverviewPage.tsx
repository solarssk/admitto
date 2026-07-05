import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Avatar, Badge, Card, PageHeader, Stat, useToast } from "@admitto/ui";
import { ApiError, fetchEventOverview } from "../api/client.js";
import type { EventDto, EventOverviewDto } from "../api/types.js";
import { formatEventCalendarDate, formatEventTime, formatUtcDateTime } from "../utils/event-dates.js";
import { useCountdown } from "../utils/event-countdown.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import {
  isAdmitDedupHit,
  pruneAdmitDedupMap,
  registerAdmitDedup,
} from "../checkin/admitDedup.js";
import { useEventStream, type StreamCheckinEvent } from "../hooks/useEventStream.js";

const OVERVIEW_REFRESH_MS = 30_000;
const RECENT_CHECKINS_MAX = 8;

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

function EmailDeliveryBars({ overview }: { overview: EventOverviewDto }) {
  const failed = overview.email_failed + overview.email_bounced;
  const total = overview.email_sent + overview.email_queued + failed;
  const pct = (val: number) =>
    total > 0 ? `${Math.max(2, Math.round((val / total) * 100))}%` : "0%";

  return (
    <div className="overview-delivery">
      {(
        [
          { label: "Sent", value: overview.email_sent, mod: "ok" },
          { label: "Pending", value: overview.email_queued, mod: "warn" },
          { label: "Failed", value: failed, mod: "error" },
        ] as const
      ).map(({ label, value, mod }) => (
        <div key={label} className="overview-bar-row">
          <span className="overview-bar-row__label">{label}</span>
          <div className="overview-bar-row__track">
            {value > 0 && (
              <div
                className={`overview-bar-row__fill overview-bar-row__fill--${mod}`}
                style={{ width: pct(value) }}
              />
            )}
          </div>
          <b className="overview-bar-row__count">{value}</b>
        </div>
      ))}
    </div>
  );
}

interface NeedsAttentionProps {
  overview: EventOverviewDto;
}

function NeedsAttentionCard({ overview }: NeedsAttentionProps) {
  const failed = overview.email_failed + overview.email_bounced;
  const alerts: Array<{ icon: string; level: "error" | "warn"; title: string; desc: string }> = [];

  if (failed > 0) {
    alerts.push({
      icon: "ti-mail-x",
      level: "error",
      title: `${failed} email ${failed === 1 ? "delivery" : "deliveries"} failed`,
      desc: `${overview.email_bounced > 0 ? `${overview.email_bounced} bounced` : ""}${overview.email_bounced > 0 && overview.email_failed > 0 ? " · " : ""}${overview.email_failed > 0 ? `${overview.email_failed} rejected` : ""}`.trim(),
    });
  }

  if (overview.email_queued > 0) {
    alerts.push({
      icon: "ti-mail-forward",
      level: "warn",
      title: `${overview.email_queued} ${overview.email_queued === 1 ? "ticket" : "tickets"} still in send queue`,
      desc: "Mailer queue processing — check mailer status if delayed",
    });
  }

  if (overview.checkin_staff_count === 0 && !overview.event.archived_at) {
    alerts.push({
      icon: "ti-qrcode",
      level: "warn",
      title: "No operators assigned for check-in",
      desc: "Assign at least one operator so staff can scan tickets",
    });
  }

  if (alerts.length === 0) {
    return (
      <Card title="Needs attention">
        <p className="overview-muted overview-all-clear">
          <i className="ti ti-circle-check" aria-hidden="true" />
          All good — no issues to action
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Needs attention"
      actions={
        <Badge variant={alerts.some((a) => a.level === "error") ? "error" : "warn"}>
          {alerts.length}
        </Badge>
      }
    >
      <div className="overview-alerts">
        {alerts.map((alert) => (
          <div key={alert.title} className={`overview-alert overview-alert--${alert.level}`}>
            <i className={`ti ${alert.icon} overview-alert__icon`} aria-hidden="true" />
            <div className="overview-alert__body">
              <strong className="overview-alert__title">{alert.title}</strong>
              {alert.desc && <span className="overview-alert__desc">{alert.desc}</span>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

interface ReadinessItem {
  label: string;
  status: "ok" | "warn" | "error" | "neutral";
  value: string;
}

function EventReadinessCard({
  overview,
  loading,
}: {
  overview: EventOverviewDto | null;
  loading: boolean;
}) {
  if (!overview) {
    return (
      <Card title="Event readiness">
        <p className="overview-muted">{loading ? "Loading…" : "Unavailable"}</p>
      </Card>
    );
  }

  const failed = overview.email_failed + overview.email_bounced;

  const items: ReadinessItem[] = [
    {
      label: "Attendees imported",
      status: overview.attendee_count > 0 ? "ok" : "warn",
      value: overview.attendee_count > 0 ? `${overview.attendee_count} guests` : "None yet",
    },
    {
      label: "Tickets sent",
      status:
        overview.attendee_count === 0
          ? "neutral"
          : overview.attendees_with_ticket >= overview.attendee_count
            ? "ok"
            : overview.attendees_with_ticket > 0
              ? "warn"
              : "error",
      value:
        overview.attendee_count === 0
          ? "—"
          : `${overview.attendees_with_ticket} / ${overview.attendee_count}`,
    },
    {
      label: "Delivery healthy",
      status: failed === 0 ? "ok" : "error",
      value: failed === 0 ? "No failures" : `${failed} failed`,
    },
    {
      label: "Check-in staff",
      status: overview.checkin_staff_count > 0 ? "ok" : "warn",
      value:
        overview.checkin_staff_count > 0
          ? `${overview.checkin_staff_count} user${overview.checkin_staff_count > 1 ? "s" : ""}`
          : "None active",
    },
    {
      label: "Event items",
      status: "neutral",
      value:
        overview.requirements_count > 0
          ? `${overview.requirements_count} configured`
          : "None",
    },
  ];

  const okCount = items.filter((i) => i.status === "ok").length;

  return (
    <Card
      title="Event readiness"
      actions={
        <span className="overview-readiness-score">
          {okCount}/{items.length}
        </span>
      }
    >
      <div className="overview-readiness">
        {items.map((item) => (
          <div key={item.label} className="overview-readiness__row">
            <span className={`overview-readiness__dot overview-readiness__dot--${item.status}`}>
              {item.status === "ok" ? (
                <i className="ti ti-check" aria-hidden="true" />
              ) : item.status === "error" ? (
                <i className="ti ti-x" aria-hidden="true" />
              ) : item.status === "warn" ? (
                <i className="ti ti-alert-triangle" aria-hidden="true" />
              ) : (
                <i className="ti ti-minus" aria-hidden="true" />
              )}
            </span>
            <span className="overview-readiness__label">{item.label}</span>
            <span className={`overview-readiness__value overview-readiness__value--${item.status}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentCheckinsCard({
  checkins,
  timezone,
  connected,
}: {
  checkins: StreamCheckinEvent[];
  timezone: string;
  connected: boolean;
}) {
  return (
    <Card
      title="Recent check-ins"
      actions={
        connected ? (
          <span className="overview-live-badge">
            <span className="overview-live-dot" aria-hidden="true" />
            live
          </span>
        ) : undefined
      }
    >
      {checkins.length === 0 ? (
        <p className="overview-muted">
          No check-ins yet — events will appear as attendees scan in.
        </p>
      ) : (
        <ul className="overview-activity">
          {checkins.map((c) => (
            <li key={`${c.attendeeId}-${c.admittedAt}`} className="overview-activity__item">
              <Avatar name={c.attendeeName} size="sm" />
              <div className="overview-activity__info">
                <strong>{c.attendeeName}</strong>
                <span>{c.ticketType ?? "—"}</span>
              </div>
              <time className="overview-activity__time">
                {formatEventTime(c.admittedAt, timezone)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventInfoCard({
  overview,
  event,
  countdown,
}: {
  overview: EventOverviewDto | null;
  event: EventDto;
  countdown: string;
}) {
  const location = overview?.event.location ?? event.location;
  const timezone = overview?.event.timezone ?? event.timezone;
  const dateIso = overview?.event.date ?? event.date;
  const capacity = overview?.event.capacity ?? null;

  const rows: Array<{ icon: string; label: string; value: string }> = [
    {
      icon: "ti-calendar",
      label: "Date",
      value: `${formatEventCalendarDate(dateIso)} · ${countdown}`,
    },
    ...(location ? [{ icon: "ti-map-pin", label: "Venue", value: location }] : []),
    { icon: "ti-world", label: "Timezone", value: timezone },
    ...(capacity != null
      ? [
          {
            icon: "ti-users",
            label: "Capacity",
            value: `${overview?.attendee_count ?? "—"} of ${capacity}`,
          },
        ]
      : []),
  ];

  return (
    <Card title="Event info">
      <div className="overview-info">
        {rows.map((row) => (
          <div key={row.label} className="overview-info__row">
            <i className={`ti ${row.icon} overview-info__icon`} aria-hidden="true" />
            <div className="overview-info__content">
              <span className="overview-info__label">{row.label}</span>
              <span className="overview-info__value">{row.value}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Event-scoped dashboard — event command center with KPIs, alerts, readiness, and live check-in feed. */
export function EventOverviewPage() {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const seenCheckinsRef = useRef(new Map<string, number>());
  const statsErrorToastedRef = useRef(false);
  const reconcileTimerRef = useRef<number | null>(null);
  const currentEventIdRef = useRef(event.id);

  useEffect(() => {
    currentEventIdRef.current = event.id;
  }, [event.id]);

  const [overview, setOverview] = useState<EventOverviewDto | null>(null);
  const [optimisticAdmittedDelta, setOptimisticAdmittedDelta] = useState(0);
  const [recentCheckins, setRecentCheckins] = useState<StreamCheckinEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const currentOverview = overview?.event.id === event.id ? overview : null;
  const eventTimezone = currentOverview?.event.timezone ?? event.timezone;
  const eventDateIso = currentOverview?.event.date ?? event.date;
  const countdown = useCountdown(eventDateIso, eventTimezone);

  const absorbServerOverview = useCallback((data: EventOverviewDto) => {
    if (data.event.id !== currentEventIdRef.current) return;
    pruneAdmitDedupMap(seenCheckinsRef.current);
    setOverview(data);
    setOptimisticAdmittedDelta(0);
  }, []);

  const scheduleReconcile = useCallback(() => {
    if (reconcileTimerRef.current != null) {
      window.clearTimeout(reconcileTimerRef.current);
    }
    reconcileTimerRef.current = window.setTimeout(() => {
      reconcileTimerRef.current = null;
      void fetchEventOverview(event.id)
        .then((data) => { absorbServerOverview(data); })
        .catch(() => { /* keep optimistic value until next poll */ });
    }, 3000);
  }, [absorbServerOverview, event.id]);

  const handleLiveCheckin = useCallback(
    (checkin: StreamCheckinEvent) => {
      if (isAdmitDedupHit(seenCheckinsRef.current, checkin.attendeeId, checkin.admittedAt)) return;
      registerAdmitDedup(seenCheckinsRef.current, checkin.attendeeId, checkin.admittedAt);
      setOptimisticAdmittedDelta((delta) => delta + 1);
      setRecentCheckins((prev) => [checkin, ...prev].slice(0, RECENT_CHECKINS_MAX));
      scheduleReconcile();
    },
    [scheduleReconcile],
  );

  const { connected: streamConnected } = useEventStream(event.id, handleLiveCheckin);

  useEffect(() => {
    abortRef.current?.abort();
    seenCheckinsRef.current.clear();
    if (reconcileTimerRef.current != null) {
      window.clearTimeout(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
    }
    setLoading(true);
    statsErrorToastedRef.current = false;
    setOverview(null);
    setOptimisticAdmittedDelta(0);
    setRecentCheckins([]);

    const load = () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      fetchEventOverview(event.id, ac.signal)
        .then((data) => {
          if (ac.signal.aborted) return;
          absorbServerOverview(data);
          statsErrorToastedRef.current = false;
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof ApiError) reportApiError(err.status);
          if (!statsErrorToastedRef.current) {
            addToast("Failed to load event stats.", "error");
            statsErrorToastedRef.current = true;
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    };

    load();
    const intervalId = setInterval(load, OVERVIEW_REFRESH_MS);

    return () => {
      clearInterval(intervalId);
      abortRef.current?.abort();
      if (reconcileTimerRef.current != null) {
        window.clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
    };
  }, [absorbServerOverview, event.id, reportApiError, addToast]);

  const attendeeCount = currentOverview?.attendee_count ?? event.attendee_count ?? null;
  const admittedCount =
    currentOverview?.admitted_count != null
      ? currentOverview.admitted_count + optimisticAdmittedDelta
      : null;
  const admitPct =
    attendeeCount != null && admittedCount != null && attendeeCount > 0
      ? Math.round((admittedCount / attendeeCount) * 100)
      : null;
  const emailFailedTotal =
    currentOverview != null
      ? currentOverview.email_failed + currentOverview.email_bounced
      : 0;

  return (
    <div className="screen">
      <PageHeader
        title={event.title}
        subtitle={
          [formatEventCalendarDate(eventDateIso), event.location].filter(Boolean).join(" · ")
        }
        actions={event.archived_at ? <Badge variant="neutral">Archived · read-only</Badge> : undefined}
      />

      {event.archived_at && (
        <p className="overview-archived-note">
          Archived on {formatUtcDateTime(event.archived_at)}. Restore from event settings if you
          need to edit again.
        </p>
      )}

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
                  ? "Loading…"
                  : "Unavailable"
                : emailFailedTotal > 0
                  ? `${emailFailedTotal} failed`
                  : currentOverview.email_queued > 0
                    ? `${currentOverview.email_queued} queued`
                    : "Delivered"
            }
          />
        </Card>
        <Card>
          <Stat
            label="Event date"
            value={countdown}
            sub={formatEventCalendarDate(eventDateIso)}
          />
        </Card>
      </div>

      <div className="overview-body">
        <div className="overview-body__left">
          {currentOverview != null ? (
            <NeedsAttentionCard overview={currentOverview} />
          ) : null}
          <EventReadinessCard overview={currentOverview} loading={loading} />
          <Card title="Email delivery">
            {currentOverview != null ? (
              <EmailDeliveryBars overview={currentOverview} />
            ) : (
              <p className="overview-muted">{loading ? "Loading…" : "Unavailable"}</p>
            )}
          </Card>
        </div>
        <div className="overview-body__right">
          <RecentCheckinsCard checkins={recentCheckins} timezone={eventTimezone} connected={streamConnected} />
          <EventInfoCard overview={currentOverview} event={event} countdown={countdown} />
        </div>
      </div>
    </div>
  );
}
