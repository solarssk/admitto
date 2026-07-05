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

/** Auto-refresh interval for event overview stats (ms). */
const OVERVIEW_REFRESH_MS = 30_000;

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

const RECENT_CHECKINS_MAX = 8;

function formatEmailDeliverySub(overview: EventOverviewDto): string {
  const parts: string[] = [];
  if (overview.email_bounced > 0) {
    parts.push(`${overview.email_bounced} bounced`);
  }
  if (overview.email_failed > 0) {
    parts.push(`${overview.email_failed} failed`);
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  if (overview.email_queued > 0) {
    return `${overview.email_queued} queued`;
  }
  return "Delivered";
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

/** Event-scoped dashboard — metrics, countdown, and shortcuts. */
export function EventOverviewPage() {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  const seenCheckinsRef = useRef(new Map<string, number>());
  const statsErrorToastedRef = useRef(false);
  /** Recent admits within admitDedup TTL — not cleared on server refresh (replay dedup); pruned instead. */
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
        .then((data) => {
          absorbServerOverview(data);
        })
        .catch(() => {
          /* keep optimistic value until next poll */
        });
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

  useEventStream(event.id, handleLiveCheckin);

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
          const message = "Failed to load event stats.";
          if (err instanceof ApiError) {
            reportApiError(err.status);
          }
          if (!statsErrorToastedRef.current) {
            addToast(message, "error");
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

  const meta = [formatEventCalendarDate(eventDateIso), event.location]
    .filter(Boolean)
    .join(" · ");

  const attendeeCount = currentOverview?.attendee_count ?? event.attendee_count ?? null;
  const admittedCount =
    currentOverview?.admitted_count != null
      ? currentOverview.admitted_count + optimisticAdmittedDelta
      : null;
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
                : formatEmailDeliverySub(currentOverview)
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

      {event.archived_at && (
        <p className="overview-archived-note">
          Archived on {formatUtcDateTime(event.archived_at)}. Restore from event
          settings if you need to edit again.
        </p>
      )}

      <div className="overview-two-col">
        <Card title="Email delivery">
          {currentOverview != null ? (
            <EmailDeliveryBars overview={currentOverview} />
          ) : (
            <p className="overview-muted">{loading ? "Loading…" : "Delivery stats unavailable"}</p>
          )}
        </Card>
        <Card title="Recent check-ins">
          {recentCheckins.length === 0 ? (
            <p className="overview-muted">No check-ins yet — events will appear as attendees scan in.</p>
          ) : (
            <ul className="overview-activity">
              {recentCheckins.map((c) => (
                <li key={`${c.attendeeId}-${c.admittedAt}`} className="overview-activity__item">
                  <Avatar name={c.attendeeName} size="sm" />
                  <div className="overview-activity__info">
                    <strong>{c.attendeeName}</strong>
                    <span>{c.ticketType ?? "—"}</span>
                  </div>
                  <time className="overview-activity__time">
                    {formatEventTime(c.admittedAt, eventTimezone)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
