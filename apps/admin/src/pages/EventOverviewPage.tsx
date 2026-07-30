import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  ModalBackdrop,
  PageHeader,
  Select,
  ticketTypeChartColor,
  useToast,
} from "@admitto/ui";
import {
  ApiError,
  fetchEventOverview,
  fetchTicketTypes,
  patchEventNote,
  createEventContact,
  updateEventContact,
  deleteEventContact,
  createEventResource,
  updateEventResource,
  deleteEventResource,
} from "../api/client.js";
import type {
  EventDto,
  EventOverviewDto,
  EventContactDto,
  EventRecentActivityEntry,
  EventResourceDto,
  TicketTypeDto,
} from "../api/types.js";
import {
  calendarDateInZone,
  formatEventCalendarDate,
  formatEventDate,
  formatEventDateTime,
  formatRelativeTime as formatRelativeTimeShared,
  formatUtcDateTime,
} from "../utils/event-dates.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import {
  isAdmitDedupHit,
  pruneAdmitDedupMap,
  registerAdmitDedup,
} from "../checkin/admitDedup.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useEventStream, type StreamCheckinEvent } from "../hooks/useEventStream.js";
import { useCountdown, daysUntilEvent } from "../utils/event-countdown.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";

const OVERVIEW_REFRESH_MS = 30_000;
const RECENT_CHECKINS_MAX = 8;
// Mirrors RECENT_ACTIVITY_LIMIT in apps/web/src/admin/overview-routes.ts — the merged feed must
// honor the same 30-item contract as the server response it's reconciling against.
const ACTIVITY_FEED_MAX = 30;

function safeHref(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}

/** Same http(s)-only rule the backend enforces (validateHttpUrl in @admitto/mail-templates) —
 * checked client-side first so an invalid URL surfaces a specific inline message (D3) instead of
 * the modal's generic save-failed toast. */
function isValidResourceUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Compact "N min/hours/days ago" for glance stats and the activity timeline - thin null
 * handling wrapper (this file's own "-" fallback) around the shared canonical implementation
 * in event-dates.ts (previously duplicated here with a different hour/day threshold; also
 * duplicated, with its own null fallback, in StaffUserListItem.tsx). */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return "-";
  return formatRelativeTimeShared(iso);
}

/** "13:00" -> "13:00–14:00" for the check-in progress card's busiest-hour glance stat. */
function formatBusiestHourRange(hour: string): string {
  const [hh, mm = "00"] = hour.split(":");
  const h = Number(hh);
  if (!Number.isFinite(h)) return hour;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${mm}–${pad((h + 1) % 24)}:${mm}`;
}

type KpiTone = "primary" | "info" | "ok" | "error";

/** Overview's own icon-square-left KPI tile (mockup-aligned): a bigger colored icon square beside
 * a stacked value/label/sub block. ReportsPage has its own separate bespoke KPI tile (ReportStat)
 * with a different layout, not shared with this one — both pages migrated off @admitto/ui's
 * generic Stat component independently, which has since been removed entirely, having ended up
 * with zero remaining consumers (see #590). */
function OverviewKpiTile({
  icon,
  tone,
  label,
  value,
  sub,
  children,
}: Readonly<{
  icon: ReactNode;
  tone: KpiTone;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <Card className="overview-kpi-card">
      <div className="overview-kpi">
        <span className={`overview-kpi__icon overview-kpi__icon--${tone}`} aria-hidden="true">
          {icon}
        </span>
        <div className="overview-kpi__body">
          <span className="overview-kpi__value">{value}</span>
          <span className="overview-kpi__label">{label}</span>
          {sub != null && <span className="overview-kpi__sub">{sub}</span>}
        </div>
      </div>
      {children}
    </Card>
  );
}

interface ReadinessItem {
  label: string;
  status: "ok" | "warn" | "error" | "neutral";
  /** Explanatory sentence shown under the label for not-ok items — no reusable readiness widget
   * exists yet under Event settings (checked before building this), so this stays local. */
  detail: string;
}

/** Merges the former "Needs attention" + "Event readiness" cards into one compact checklist
 * (#348) — same readiness computation the old EventReadinessCard used, just surfaced as a short
 * "what still needs doing" list instead of two full-height cards. */
// Ticket-sent status has 3 outcomes (not counted / needs attention / fully done), so it gets its
// own small function instead of a nested ternary chain (readability, SonarCloud S3358).
function ticketsSentReadiness(overview: EventOverviewDto): Pick<ReadinessItem, "status" | "detail"> {
  if (overview.attendee_count === 0) {
    return { status: "neutral", detail: "Import attendees before sending tickets." };
  }
  const detail = `${overview.attendees_with_ticket} of ${overview.attendee_count} attendees have received their ticket.`;
  if (overview.attendees_with_ticket >= overview.attendee_count) {
    return { status: "ok", detail };
  }
  if (overview.attendees_with_ticket > 0) {
    return { status: "warn", detail };
  }
  return { status: "error", detail: "No attendees have received their ticket yet." };
}

// Extracted out of SetupChecklistCard (SonarCloud S3776: keeps the branching/pluralization logic
// out of the component's own cognitive-complexity count, which the JSX below also contributes to).
function buildReadinessItems(overview: EventOverviewDto): ReadinessItem[] {
  const failed = overview.email_failed + overview.email_bounced;
  const ticketsSent = ticketsSentReadiness(overview);

  const attendeePlural = overview.attendee_count === 1 ? "" : "s";
  const attendeesImportedDetail =
    overview.attendee_count > 0
      ? `${overview.attendee_count} attendee${attendeePlural} imported.`
      : "No attendees have been imported yet.";
  const emailPlural = failed === 1 ? "" : "s";
  const deliveryHealthyDetail =
    failed === 0 ? "No delivery failures." : `${failed} ticket email${emailPlural} failed or bounced.`;
  const staffPlural = overview.checkin_staff_count > 1 ? "s" : "";
  const checkinStaffDetail =
    overview.checkin_staff_count > 0
      ? `${overview.checkin_staff_count} user${staffPlural} can perform check-in.`
      : "No staff can perform check-in yet.";
  const eventItemsDetail =
    overview.requirements_count > 0 ? `${overview.requirements_count} configured.` : "None configured.";

  return [
    {
      label: "Attendees imported",
      status: overview.attendee_count > 0 ? "ok" : "warn",
      detail: attendeesImportedDetail,
    },
    {
      label: "Tickets sent",
      status: ticketsSent.status,
      detail: ticketsSent.detail,
    },
    {
      label: "Email delivery",
      status: failed === 0 ? "ok" : "error",
      detail: deliveryHealthyDetail,
    },
    {
      label: "Check-in staff",
      status: overview.checkin_staff_count > 0 ? "ok" : "warn",
      detail: checkinStaffDetail,
    },
    {
      label: "Event items",
      status: "neutral",
      detail: eventItemsDetail,
    },
  ];
}

// Errors before warnings so the most urgent item is never bumped off the top-3 by an earlier,
// less pressing warning (mirrors the old Needs attention card's own priority order).
function topUnresolvedReadinessItems(items: ReadinessItem[]): ReadinessItem[] {
  const urgency: Record<ReadinessItem["status"], number> = { error: 0, warn: 1, ok: 2, neutral: 3 };
  return items
    .filter((i) => i.status === "warn" || i.status === "error")
    .sort((a, b) => urgency[a.status] - urgency[b.status])
    .slice(0, 3);
}

/** Placeholder text for a card whose `overview` hasn't arrived yet: blank during the no-flash
 * grace window, "Loading…" once the fetch has genuinely taken a moment, "Unavailable" once it's
 * settled with nothing (shared by SetupChecklistCard and CheckInProgressCard). */
function unavailablePlaceholderText(loading: boolean, showLoading: boolean): string {
  if (loading) return showLoading ? "Loading…" : "";
  return "Unavailable";
}

function SetupChecklistCard({
  overview,
  loading,
  showLoading,
  eventId,
}: Readonly<{
  overview: EventOverviewDto | null;
  loading: boolean;
  showLoading: boolean;
  eventId: string;
}>) {
  if (!overview) {
    return (
      <Card title="Setup checklist" className="overview-card--fill">
        <p className="overview-muted">
          {unavailablePlaceholderText(loading, showLoading)}
        </p>
      </Card>
    );
  }

  const items = buildReadinessItems(overview);
  const okCount = items.filter((i) => i.status === "ok").length;
  const total = items.filter((i) => i.status !== "neutral").length;
  const notOk = topUnresolvedReadinessItems(items);

  return (
    <Card
      title="Setup checklist"
      className="overview-card--fill"
      actions={
        <span className="overview-readiness-score">
          {okCount}/{total}
        </span>
      }
    >
      {notOk.length === 0 ? (
        <p className="overview-muted overview-all-clear">
          <i className="ti ti-circle-check" aria-hidden="true" />{" "}
          All checks look good
        </p>
      ) : (
        <div className="overview-checklist">
          {notOk.map((item) => (
            <div key={item.label} className="overview-readiness-item">
              <span className={`status-circle status-circle--${item.status}`} aria-hidden="true">
                {item.status === "error" ? (
                  <i className="ti ti-x" aria-hidden="true" />
                ) : (
                  <i className="ti ti-alert-triangle" aria-hidden="true" />
                )}
              </span>
              <div className="overview-readiness-item__body">
                <strong>{item.label}</strong>
                <span className="overview-readiness-item__detail">{item.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Link to={`/admin/events/${eventId}/settings?tab=general`} className="overview-checklist__link">
        View full checklist in Event settings <i className="ti ti-arrow-right" aria-hidden="true" />
      </Link>
    </Card>
  );
}

/** Check-in progress card (new, Part B): admission ring, ticket-type breakdown, and two glance
 * stats — the ring uses a real conic-gradient over --status-ok / --surface-sunken rather than an
 * SVG/canvas dependency. Takes the optimistic-delta-inclusive `admittedCount` (not just
 * `overview.admitted_count`) so the ring still updates instantly on a live check-in — the removed
 * "Checked in" KPI tile (#E1) used to be the only place that instant bump was visible; this is now
 * the sole admission display, so it needs to stay just as responsive. */
function CheckInProgressCard({
  overview,
  loading,
  showLoading,
  admittedCount,
}: Readonly<{
  overview: EventOverviewDto | null;
  loading: boolean;
  showLoading: boolean;
  admittedCount: number | null;
}>) {
  if (!overview) {
    return (
      <Card title="Check-in progress" className="overview-card--header-fixed">
        <p className="overview-muted">
          {unavailablePlaceholderText(loading, showLoading)}
        </p>
      </Card>
    );
  }

  const total = overview.attendee_count;
  const admitted = Math.min(admittedCount ?? overview.admitted_count, total);
  const notYet = Math.max(total - admitted, 0);
  const pct = total > 0 ? Math.round((admitted / total) * 100) : 0;
  // --border-strong (#cbd5e1, ~1.5:1 contrast vs white) rather than a --text-muted-based mix
  // (PO review, round 2): the previous ~3.2:1 mix sat too close in weight to --at-gray-500, which
  // "By ticket type" below now uses for its own "Gray" swatch (ticketTypeChartColor) — reading as
  // the same gray made the ring's neutral "not yet" wedge look like it belonged to that unrelated
  // category legend. --border-strong is a clearly lighter, purely structural token (also used for
  // borders/dividers elsewhere) that no longer visually competes with real ticket-type swatches.
  // Under the 3:1 floor is acceptable here specifically because the count is redundant with
  // accessible text right next to it (ring-center "{pct}%", legend "Not yet {notYet}").
  const notYetColor = "var(--border-strong)";
  // Defensive fallback: a stale apps/web dev process (no watch mode) still running from before
  // this field existed on the overview API would otherwise crash the whole page (same class of
  // gap already hardened on the Attendee Detail page's `event_items ?? []`).
  const breakdown = (overview.ticket_type_breakdown ?? []).filter((t) => t.count > 0);
  const breakdownTotal = breakdown.reduce((sum, t) => sum + t.count, 0);

  // A ring at a permanent 0% is noise, not information, when there's nobody to check in yet —
  // same icon+text placeholder treatment as Recent activity's empty state instead (PO review).
  const body =
    total === 0 ? (
      <EmptyState
        icon={<i className="ti ti-users" aria-hidden="true" />}
        title="No attendees yet"
        description="Import attendees to start tracking check-ins."
      />
    ) : (
      <>
        <div className="overview-progress">
          <div
            className="overview-ring"
            style={{
              // notYetColor: deliberately under the 3:1 graphical-object floor here (see const
              // above) so the "not yet" wedge reads as a neutral track, not a ticket-type swatch.
              background: `conic-gradient(var(--status-ok) 0% ${pct}%, ${notYetColor} ${pct}% 100%)`,
            }}
            role="img"
            aria-label={`${pct}% of attendees checked in`}
          >
            <div className="overview-ring__hole">
              <span className="overview-ring__pct">{pct}%</span>
            </div>
          </div>
          <div className="overview-progress__legend">
            <div className="overview-progress__legend-item">
              <span className="overview-progress__legend-dot" style={{ background: "var(--status-ok)" }} />{" "}
              Checked in <strong>{admitted}</strong>
            </div>
            <div className="overview-progress__legend-item">
              <span className="overview-progress__legend-dot" style={{ background: notYetColor }} />{" "}
              Not yet <strong>{notYet}</strong>
            </div>
          </div>
        </div>

        {breakdown.length > 1 && (
          <div className="overview-tt-breakdown">
            <span className="overline">By ticket type</span>
            <div className="overview-tt-bar">
              {breakdown.map((t) => (
                <span
                  key={t.key}
                  className="overview-tt-bar__seg"
                  style={{
                    width: `${breakdownTotal > 0 ? (t.count / breakdownTotal) * 100 : 0}%`,
                    background: ticketTypeChartColor(t.color),
                  }}
                />
              ))}
            </div>
            <div className="overview-tt-legend">
              {breakdown.map((t) => (
                <span key={t.key} className="overview-tt-legend__item">
                  <span
                    className="overview-tt-legend__dot"
                    style={{ background: ticketTypeChartColor(t.color) }}
                  />
                  {t.label} <span className="overview-tt-legend__count">{t.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="overview-glance">
          <div className="overview-glance__tile">
            <span className="overview-glance__label">
              <i className="ti ti-clock" aria-hidden="true" /> Last check-in
            </span>
            <span className="overview-glance__value">{formatRelativeTime(overview.last_check_in_at)}</span>
          </div>
          <div className="overview-glance__tile">
            <span className="overview-glance__label">
              <i className="ti ti-trending-up" aria-hidden="true" /> Busiest hour
            </span>
            <span className="overview-glance__value">
              {overview.busiest_hour ? formatBusiestHourRange(overview.busiest_hour.hour) : "-"}
            </span>
          </div>
        </div>
      </>
    );

  return (
    <Card
      title="Check-in progress"
      className={`overview-card--header-fixed${total === 0 ? " overview-card--empty" : ""}`}
    >
      {body}
    </Card>
  );
}

/** A `recent_activity` row, plus the optional client-only ticket type key SSE carries — present
 * only on entries built locally from a live check-in (see mergeActivity) before the next overview
 * poll/reconcile replaces it with the server's own (badge-less) copy of the same event. */
interface DisplayActivityEntry extends EventRecentActivityEntry {
  ticketType?: string | null;
}

const ACTIVITY_ICONS: Record<EventRecentActivityEntry["type"], string> = {
  checkin: "ti-user-check",
  mail_bounced: "ti-mail-x",
  mail_failed: "ti-mail-x",
  mail_resent: "ti-mail-forward",
  import: "ti-upload",
};

// Uniform icon+tone treatment across every activity type, checkin included — was previously an
// Avatar (name initials) special-case for checkin only, inconsistent with every other row's
// action-colored circle (mail bounce = error red, import = muted, etc.) in the same list (PO
// review). tone is already "ok" for checkin, so this renders the same green-toned circle used
// elsewhere for a successful action.
function ActivityIcon({ entry }: Readonly<{ entry: DisplayActivityEntry }>) {
  return (
    <span className={`status-circle status-circle--sm status-circle--${entry.tone}`} aria-hidden="true">
      <i className={`ti ${ACTIVITY_ICONS[entry.type]}`} />
    </span>
  );
}

/** Live SSE check-ins reshaped to look like a `recent_activity` row so they can render in the
 * same timeline immediately, ahead of the next overview poll (#373). */
function liveCheckinsAsActivity(checkins: StreamCheckinEvent[]): DisplayActivityEntry[] {
  return checkins.map((c) => ({
    id: `live-checkin:${c.attendeeId}-${c.admittedAt}`,
    type: "checkin",
    tone: "ok",
    attendee_name: c.attendeeName,
    attendee_id: c.attendeeId,
    message: "checked in",
    occurred_at: c.admittedAt,
    ticketType: c.ticketType,
  }));
}

/** Merges not-yet-reconciled live check-ins into the server's own feed, without duplicating one
 * once the next overview poll/reconcile brings the same check-in back as a server row — matched
 * on attendee name + timestamp since `recent_activity` doesn't carry an attendee id. Re-sorted and
 * re-capped rather than simply prepended: if the event stays open long enough that a live
 * check-in ages out of the server's own capped window before it reconciles (30+ newer activities
 * of any type in between), naive prepending would strand it above genuinely newer server rows. */
function mergeActivity(
  server: EventRecentActivityEntry[],
  liveCheckins: StreamCheckinEvent[],
): DisplayActivityEntry[] {
  // Matched on attendee_id, not name+timestamp: SSE's admittedAt is the app's own `new Date()`
  // at admit time, while the server's occurred_at is CheckIn.checked_in_at's DB-side default —
  // those two clocks never line up exactly, so a string match on the pair always missed and left
  // both the live and server rows visible after reconcile (CodeRabbit). attendee_id is safe here
  // because revoking a check-in deletes its CheckIn row outright, so at most one "checkin" row
  // per attendee can ever be live at once.
  const seenAttendeeIds = new Set(
    server.filter((e) => e.type === "checkin" && e.attendee_id).map((e) => e.attendee_id),
  );
  const live = liveCheckinsAsActivity(liveCheckins).filter(
    (e) => !(e.attendee_id && seenAttendeeIds.has(e.attendee_id)),
  );
  return [...live, ...server]
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, ACTIVITY_FEED_MAX);
}

function activityDayLabel(iso: string, timezone: string): string {
  const day = calendarDateInZone(iso, timezone);
  const today = calendarDateInZone(new Date().toISOString(), timezone);
  if (day === today) return "Today";
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
  if (day === yesterday) return "Yesterday";
  return formatEventDate(iso, timezone);
}

/** Groups an already newest-first list into contiguous same-day runs (Today/Yesterday/date). */
function groupActivityByDay(
  entries: DisplayActivityEntry[],
  timezone: string,
): Array<{ key: string; label: string; items: DisplayActivityEntry[] }> {
  const groups: Array<{ key: string; label: string; items: DisplayActivityEntry[] }> = [];
  for (const entry of entries) {
    const key = calendarDateInZone(entry.occurred_at, timezone);
    const last = groups.at(-1);
    if (last?.key === key) {
      last.items.push(entry);
    } else {
      groups.push({ key, label: activityDayLabel(entry.occurred_at, timezone), items: [entry] });
    }
  }
  return groups;
}

type ActivityFilter = "all" | "issues";

const ACTIVITY_FILTER_OPTIONS: ReadonlyArray<SegmentedOption<ActivityFilter>> = [
  { value: "all", label: "All" },
  { value: "issues", label: "Issues" },
];

/** Recent activity card (replaces "Recent check-ins", #373 + Part B): a day-grouped timeline of
 * check-ins, mail failures/bounces, and imports, with an All/Issues filter. */
function RecentActivityCard({
  eventId,
  activity,
  liveCheckins,
  ticketTypes,
  timezone,
}: Readonly<{
  eventId: string;
  activity: EventRecentActivityEntry[];
  liveCheckins: StreamCheckinEvent[];
  ticketTypes: TicketTypeDto[];
  timezone: string;
}>) {
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const merged = useMemo(() => mergeActivity(activity, liveCheckins), [activity, liveCheckins]);
  const filtered =
    filter === "issues" ? merged.filter((e) => e.tone === "warn" || e.tone === "error") : merged;
  const groups = useMemo(() => groupActivityByDay(filtered, timezone), [filtered, timezone]);
  const emptyState =
    filter === "issues" ? (
      <EmptyState
        icon={<i className="ti ti-circle-check" aria-hidden="true" />}
        title="No issues right now"
        description="Everything's running smoothly."
      />
    ) : (
      <EmptyState
        icon={<i className="ti ti-history" aria-hidden="true" />}
        title="No activity yet"
        description="Check-ins, mail, and imports will appear here."
      />
    );

  return (
    <Card
      title="Recent activity"
      className="overview-card--header-fixed"
      actions={
        <>
          {/* Reuses the app's established Segmented control (AuditLogPanel's System/Audit
           * toggle, the event Mail tab's Organization/Dedicated toggle) instead of a bespoke
           * pill-shaped fieldset, so this filter matches the same toggle standard used in
           * Instance Settings rather than its own one-off styling. className mirrors
           * .seg-control.audit-log-view-toggle's own header-sizing fix (staff.css). */}
          <Segmented
            options={ACTIVITY_FILTER_OPTIONS}
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter activity"
            className="overview-activity-filter"
          />
          {/* Reuses the app's established dot-badge pattern for a live/active signal (Badge
           * variant="ok" dot — same as CfAccessEditor/IdentityProvidersPanel's "Active"/"Enabled"
           * pills) instead of a bespoke dot+text pair; .overview-live-badge only adds the pulse.
           * Always rendered (#C review): this affirms "this feed receives live updates" as a
           * static design element, matching the mockup, not the literal SSE handshake state — it
           * used to be gated behind `streamConnected`, which is false for a beat right after page
           * load and during a reconnect, making the badge flicker in and out. The actual
           * connection health already has its own surface (e.g. CheckInPage's stream status
           * banner), so this one stays unconditional. */}
          <Badge variant="ok" dot className="overview-live-badge">
            live
          </Badge>
        </>
      }
    >
      {/* Fixed-height scroll container (staff.css .overview-timeline) always renders, even for
       * the 0/1-item case, so the card's footprint never shrinks when the All/Issues filter
       * narrows the result set. Zero matches get a real centered empty state (not a top-left
       * paragraph over dead space) via the shared EmptyState component (#A2). */}
      <div className={`overview-timeline${filtered.length === 0 ? " overview-timeline--empty" : ""}`}>
        {filtered.length === 0 ? (
          emptyState
        ) : (
          groups.map((group) => (
            <div key={group.key} className="overview-timeline__group">
              <div className="overview-timeline__day">{group.label}</div>
              <ul className="overview-activity">
                {group.items.map((entry) => (
                  <li key={entry.id} className="overview-activity__item">
                    <ActivityIcon entry={entry} />
                    <div className="overview-activity__info">
                      {entry.attendee_name ? (
                        <>
                          {entry.attendee_id ? (
                            <Link
                              to={`/admin/events/${eventId}/attendees/${entry.attendee_id}`}
                              className="overview-activity__attendee-link"
                            >
                              <strong>{entry.attendee_name}</strong>
                            </Link>
                          ) : (
                            <strong>{entry.attendee_name}</strong>
                          )}
                          <span>
                            {entry.message}
                            {entry.ticketType !== undefined && (
                              <TicketTypeBadge ticketType={entry.ticketType} catalog={ticketTypes} />
                            )}
                          </span>
                        </>
                      ) : (
                        <strong>{entry.message}</strong>
                      )}
                    </div>
                    {/* Relative time on top, absolute below in a smaller muted style (#D) — no
                     * existing relative+absolute pairing to reuse elsewhere (checked check-in
                     * history, audit log, delivery log: each shows only one or the other), so
                     * this follows the closest established convention instead, the two-line
                     * stacked time cell from AttendeesTable's CheckInCell (bold/primary line over
                     * a smaller muted line). */}
                    <time className="overview-activity__time" dateTime={entry.occurred_at}>
                      <span className="overview-activity__time-relative">
                        {formatRelativeTime(entry.occurred_at)}
                      </span>
                      <span className="overview-activity__time-absolute">
                        {formatEventDateTime(entry.occurred_at, timezone)}
                      </span>
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

/** One labeled sub-section inside `NotesAndContactsCard` — an `.overline` heading plus optional
 * header action, replacing what used to be its own `<Card title=…>`. */
function NotesSection({
  label,
  action,
  children,
}: Readonly<{
  label: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <div className="overview-notes-section">
      <div className="overview-notes-section__header">
        <span className="overline">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Shared modal shell for the three Notes & contacts add/edit forms (pinned note, contact,
 * resource) — same dialog/backdrop/panel structure and `useModalFocusTrap` other admin modals
 * use (e.g. `NoteModal`, `EventCustomFieldModal`), just scoped to this page instead of a new
 * shared component. Add and edit for a given entity render through the same instance, so the
 * two modes can never drift apart in width/layout — only the field values and submit label
 * differ (fixes the PO's add-vs-edit width mismatch). */
function OverviewModal({
  titleId,
  title,
  onClose,
  footer,
  children,
}: Readonly<{
  titleId: string;
  title: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}>) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, true, onClose);

  return (
    <dialog open className="overview-modal" aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={onClose} />
      <div ref={panelRef} className="overview-modal__panel">
        <h2 id={titleId} className="overview-modal__title">
          {title}
        </h2>
        <div className="overview-modal__body">{children}</div>
        <div className="overview-modal__footer">{footer}</div>
      </div>
    </dialog>
  );
}

function PinnedNoteModal({
  note,
  onClose,
  onSave,
}: Readonly<{
  note: string | null;
  onClose: () => void;
  onSave: (note: string | null) => Promise<void>;
}>) {
  const titleId = useId();
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft.trim() || null);
      onClose();
    } catch {
      // onSave already surfaced the error via toast; keep the modal open so staff can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <OverviewModal
      titleId={titleId}
      title={note ? "Edit pinned note" : "Add pinned note"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <textarea
        className="overview-note-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Short operational note visible to all staff…"
        rows={4}
        autoFocus
      />
    </OverviewModal>
  );
}

function ContactModal({
  contact,
  onClose,
  onAdd,
  onUpdate,
}: Readonly<{
  contact: EventContactDto | null;
  onClose: () => void;
  onAdd: (data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
}>) {
  const titleId = useId();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      };
      if (contact) {
        await onUpdate(contact.id, data);
      } else {
        await onAdd(data);
      }
      onClose();
    } catch {
      // onAdd/onUpdate already surfaced the error via toast; keep the modal open so staff can retry.
    } finally {
      setSaving(false);
    }
  };

  let submitLabel: string;
  if (saving) {
    submitLabel = "Saving…";
  } else if (contact) {
    submitLabel = "Save";
  } else {
    submitLabel = "Add";
  }

  return (
    <OverviewModal
      titleId={titleId}
      title={contact ? "Edit contact" : "Add contact"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={saving || !form.name.trim()}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <Input
        label="Name *"
        icon={<i className="ti ti-user" aria-hidden="true" />}
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        autoFocus
      />
      <Input
        label="Role"
        icon={<i className="ti ti-briefcase" aria-hidden="true" />}
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
      />
      <Input
        label="Phone"
        icon={<i className="ti ti-phone" aria-hidden="true" />}
        value={form.phone}
        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
      />
      <Input
        label="Email"
        // type="email" is what actually triggers Safari's iCloud "Hide My Email" suggestion chip
        // regardless of autocomplete/data-* opt-outs below — AddAttendeeModal.tsx and
        // AttendeeDetailPage.tsx already work around this the same way (type="text" +
        // inputMode="email" for the mobile keyboard); no native email-format validation was
        // actually relied on here (handleSubmit only trims/nulls it), so nothing is lost.
        type="text"
        inputMode="email"
        icon={<i className="ti ti-mail" aria-hidden="true" />}
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        {...NO_AUTOFILL_PROPS}
        name="event-contact-email"
      />
    </OverviewModal>
  );
}

function ResourceModal({
  resource,
  onClose,
  onAdd,
  onUpdate,
}: Readonly<{
  resource: EventResourceDto | null;
  onClose: () => void;
  onAdd: (data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
}>) {
  const titleId = useId();
  const [form, setForm] = useState({
    title: resource?.title ?? "",
    type: resource?.type ?? ("link" as "link" | "file"),
    url: resource?.url ?? "",
    description: resource?.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.url.trim() || saving) return;
    const trimmedUrl = form.url.trim();
    if (!isValidResourceUrl(trimmedUrl)) {
      setUrlError("Enter a valid URL starting with http:// or https://");
      return;
    }
    setSaving(true);
    try {
      const data = {
        title: form.title.trim(),
        type: form.type,
        url: trimmedUrl,
        description: form.description.trim() || null,
      };
      if (resource) {
        await onUpdate(resource.id, data);
      } else {
        await onAdd(data);
      }
      onClose();
    } catch {
      // onAdd/onUpdate already surfaced the error via toast; keep the modal open so staff can retry.
    } finally {
      setSaving(false);
    }
  };

  let submitLabel: string;
  if (saving) {
    submitLabel = "Saving…";
  } else if (resource) {
    submitLabel = "Save";
  } else {
    submitLabel = "Add";
  }

  return (
    <OverviewModal
      titleId={titleId}
      title={resource ? "Edit link or file" : "Add link or file"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={saving || !form.title.trim() || !form.url.trim()}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <Input
        label="Title *"
        icon={<i className="ti ti-heading" aria-hidden="true" />}
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        autoFocus
      />
      <Select
        label="Type"
        className="overview-resource-modal__type"
        value={form.type}
        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "link" | "file" }))}
      >
        <option value="link">Link</option>
        <option value="file">File</option>
      </Select>
      <Input
        label="URL *"
        icon={<i className="ti ti-link" aria-hidden="true" />}
        value={form.url}
        error={urlError ?? undefined}
        onChange={(e) => {
          setForm((f) => ({ ...f, url: e.target.value }));
          setUrlError(null);
        }}
      />
      <Input
        label="Description"
        icon={<i className="ti ti-file-text" aria-hidden="true" />}
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
    </OverviewModal>
  );
}

function PinnedNoteSection({
  note,
  loading,
  showLoading,
  archived,
  onSave,
}: Readonly<{
  note: string | null;
  loading: boolean;
  showLoading: boolean;
  archived: boolean;
  onSave: (note: string | null) => Promise<void>;
}>) {
  const [modalOpen, setModalOpen] = useState(false);

  // The pin icon renders in both the empty and filled states (previously filled-only), so the
  // header's icon+label never shifts when a note is added or cleared (PO: "headers move").
  const label = (
    <>
      <i className="ti ti-pin overview-notes-section__icon overview-pinned-note__pin" aria-hidden="true" /> Pinned note
    </>
  );

  let body: ReactNode;
  if (note) {
    body = <p className="overview-pinned-note__body">{note}</p>;
  } else if (loading) {
    body = showLoading ? <p className="overview-muted">Loading…</p> : null;
  } else if (archived) {
    body = <p className="overview-muted">No operational note.</p>;
  } else {
    body = (
      <button type="button" className="overview-note-empty" onClick={() => setModalOpen(true)}>
        <i className="ti ti-plus" aria-hidden="true" />{" "}
        Add a pinned note for staff
      </button>
    );
  }

  return (
    <>
      <NotesSection
        label={label}
        action={
          // Unchanged from before: the Edit button only ever appears once a note exists — adding
          // the first note is now triggered by the empty-state box above instead of a header action.
          note && !archived ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<i className="ti ti-pencil" aria-hidden="true" />}
              onClick={() => setModalOpen(true)}
              aria-label="Edit pinned note"
            >
              Edit
            </Button>
          ) : undefined
        }
      >
        {body}
      </NotesSection>
      {modalOpen && <PinnedNoteModal note={note} onClose={() => setModalOpen(false)} onSave={onSave} />}
    </>
  );
}

function KeyContactsSection({
  contacts,
  loading,
  showLoading,
  archived,
  onAdd,
  onUpdate,
  onDelete,
}: Readonly<{
  contacts: EventContactDto[];
  loading: boolean;
  showLoading: boolean;
  archived: boolean;
  onAdd: (data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}>) {
  const [modalTarget, setModalTarget] = useState<"add" | EventContactDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setSaving(true);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch {
      setDeleteError("Failed to delete contact.");
    } finally {
      setSaving(false);
    }
  };

  // Same empty-state affordance as PinnedNoteSection (dashed clickable box, header action only
  // once there's something to add more to) instead of a plain "No contacts yet." line + header
  // Add button, so all three Notes & contacts sub-sections read the same way when empty (PO review).
  let body: ReactNode;
  if (contacts.length > 0) {
    body = (
      <ul className="overview-contacts">
        {contacts.map((contact) => (
          <li key={contact.id} className="overview-contact">
            <Avatar name={contact.name} size="sm" />
            <div className="overview-contact__info">
              <strong>{contact.name}</strong>
              {contact.role && <span>{contact.role}</span>}
              {contact.note && <span className="overview-contact__note">{contact.note}</span>}
            </div>
            <div className="overview-contact__actions">
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="overview-contact__action" aria-label={`Call ${contact.name}`}>
                  <i className="ti ti-phone" aria-hidden="true" />
                </a>
              )}
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="overview-contact__action" aria-label={`Email ${contact.name}`}>
                  <i className="ti ti-mail" aria-hidden="true" />
                </a>
              )}
              {!archived && (
                <>
                  <button type="button" className="overview-contact__action" onClick={() => setModalTarget(contact)} aria-label={`Edit ${contact.name}`}>
                    <i className="ti ti-pencil" aria-hidden="true" />
                  </button>
                  <button type="button" className="overview-contact__action overview-contact__action--delete" onClick={() => { setDeleteError(null); setConfirmDeleteId(contact.id); }} aria-label={`Delete ${contact.name}`}>
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (loading) {
    body = showLoading ? <p className="overview-muted">Loading…</p> : null;
  } else if (archived) {
    body = <p className="overview-muted">No contacts yet.</p>;
  } else {
    body = (
      <button type="button" className="overview-note-empty" onClick={() => setModalTarget("add")}>
        <i className="ti ti-plus" aria-hidden="true" />{" "}
        Add a key contact
      </button>
    );
  }

  return (
    <NotesSection
      label={
        <>
          <i className="ti ti-address-book overview-notes-section__icon" aria-hidden="true" /> Key contacts
        </>
      }
      action={
        !archived && contacts.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" icon={<i className="ti ti-plus" aria-hidden="true" />} onClick={() => setModalTarget("add")}>
            Add
          </Button>
        ) : undefined
      }
    >
      {body}
      {modalTarget && (
        <ContactModal
          contact={modalTarget === "add" ? null : modalTarget}
          onClose={() => setModalTarget(null)}
          onAdd={onAdd}
          onUpdate={onUpdate}
        />
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete contact"
        message="Remove this contact? This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={saving}
        errorMessage={deleteError}
        onConfirm={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId); }}
        onCancel={() => { setConfirmDeleteId(null); setDeleteError(null); }}
      />
    </NotesSection>
  );
}

function LinksFilesSection({
  resources,
  loading,
  showLoading,
  archived,
  onAdd,
  onUpdate,
  onDelete,
}: Readonly<{
  resources: EventResourceDto[];
  loading: boolean;
  showLoading: boolean;
  archived: boolean;
  onAdd: (data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onUpdate: (id: string, data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}>) {
  const PREVIEW_MAX = 4;
  const [showAll, setShowAll] = useState(false);
  const [modalTarget, setModalTarget] = useState<"add" | EventResourceDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const visible = showAll ? resources : resources.slice(0, PREVIEW_MAX);
  const hiddenCount = resources.length - PREVIEW_MAX;

  const handleDelete = async (id: string) => {
    setSaving(true);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch {
      setDeleteError("Failed to delete link.");
    } finally {
      setSaving(false);
    }
  };

  // Same empty-state affordance as PinnedNoteSection/KeyContactsSection (PO review).
  let body: ReactNode;
  if (resources.length > 0) {
    body = (
      <>
        <ul className="overview-resources">
          {visible.map((r) => (
            <li key={r.id} className="overview-resource">
              <i
                className={`ti ${r.type === "file" ? "ti-file" : "ti-link"} overview-resource__icon`}
                aria-hidden="true"
              />
              <div className="overview-resource__info">
                <a
                  href={safeHref(r.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="overview-resource__title"
                >
                  {r.title}
                </a>
                {r.description && <span className="overview-resource__desc">{r.description}</span>}
              </div>
              {!archived && (
                <div className="overview-resource__actions">
                  <button type="button" className="overview-contact__action" onClick={() => setModalTarget(r)} aria-label={`Edit ${r.title}`}>
                    <i className="ti ti-pencil" aria-hidden="true" />
                  </button>
                  <button type="button" className="overview-contact__action overview-contact__action--delete" onClick={() => { setDeleteError(null); setConfirmDeleteId(r.id); }} aria-label={`Delete ${r.title}`}>
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!showAll && hiddenCount > 0 && (
          <button type="button" className="overview-resources__show-more" onClick={() => setShowAll(true)}>
            View all resources ({hiddenCount} more)
          </button>
        )}
      </>
    );
  } else if (loading) {
    body = showLoading ? <p className="overview-muted">Loading…</p> : null;
  } else if (archived) {
    body = <p className="overview-muted">No links or files yet.</p>;
  } else {
    body = (
      <button type="button" className="overview-note-empty" onClick={() => setModalTarget("add")}>
        <i className="ti ti-plus" aria-hidden="true" />{" "}
        Add a link or file
      </button>
    );
  }

  return (
    <NotesSection
      label={
        <>
          <i className="ti ti-paperclip overview-notes-section__icon" aria-hidden="true" /> Links & files
        </>
      }
      action={
        !archived && resources.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" icon={<i className="ti ti-plus" aria-hidden="true" />} onClick={() => setModalTarget("add")}>
            Add
          </Button>
        ) : undefined
      }
    >
      {body}
      {modalTarget && (
        <ResourceModal
          resource={modalTarget === "add" ? null : modalTarget}
          onClose={() => setModalTarget(null)}
          onAdd={onAdd}
          onUpdate={onUpdate}
        />
      )}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete link"
        message="Remove this link? This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={saving}
        errorMessage={deleteError}
        onConfirm={() => { if (confirmDeleteId) void handleDelete(confirmDeleteId); }}
        onCancel={() => { setConfirmDeleteId(null); setDeleteError(null); }}
      />
    </NotesSection>
  );
}

/** Merges the former Pinned note / Key contacts / Important links & files cards (#344, #345,
 * #346) into one Card with three labeled sub-sections, matching the mockup's Overview layout —
 * only the outer wrapping changed, each section keeps its own state/handlers/rows untouched. */
function NotesAndContactsCard(props: Readonly<{
  pinnedNote: string | null;
  loading: boolean;
  showLoading: boolean;
  archived: boolean;
  onSaveNote: (note: string | null) => Promise<void>;
  contacts: EventContactDto[];
  onAddContact: (data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onUpdateContact: (id: string, data: { name: string; role?: string | null; phone?: string | null; email?: string | null }) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  resources: EventResourceDto[];
  onAddResource: (data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onUpdateResource: (id: string, data: { title: string; type: "link" | "file"; url: string; description?: string | null }) => Promise<void>;
  onDeleteResource: (id: string) => Promise<void>;
}>) {
  return (
    <Card title="Notes & contacts" className="overview-card--fill">
      <PinnedNoteSection
        note={props.pinnedNote}
        loading={props.loading}
        showLoading={props.showLoading}
        archived={props.archived}
        onSave={props.onSaveNote}
      />
      <KeyContactsSection
        contacts={props.contacts}
        loading={props.loading}
        showLoading={props.showLoading}
        archived={props.archived}
        onAdd={props.onAddContact}
        onUpdate={props.onUpdateContact}
        onDelete={props.onDeleteContact}
      />
      <LinksFilesSection
        resources={props.resources}
        loading={props.loading}
        showLoading={props.showLoading}
        archived={props.archived}
        onAdd={props.onAddResource}
        onUpdate={props.onUpdateResource}
        onDelete={props.onDeleteResource}
      />
    </Card>
  );
}

/** A KPI tile's numeric value has 3 states: the real count once loaded, an ellipsis while the
 * initial fetch is in flight, or a dash if it never arrived — extracted so the 3 tiles reading
 * straight off `currentOverview` don't each repeat the same nested ternary. `loading` (raw) picks
 * the state; `showLoading` (delayed) only decides whether the ellipsis itself renders yet, so a
 * fetch still within the no-flash grace window renders blank instead of prematurely claiming the
 * value is unavailable ("—"). */
function kpiCountText(value: number | null, loading: boolean, showLoading: boolean): string {
  if (value != null) return String(value);
  if (loading) return showLoading ? "…" : "";
  return "-";
}

/** Event-scoped dashboard — event command center with KPIs, a setup checklist, check-in progress,
 * and a live activity feed. */
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
  const [contacts, setContacts] = useState<EventContactDto[]>([]);
  const [resources, setResources] = useState<EventResourceDto[]>([]);
  const [pinnedNote, setPinnedNote] = useState<string | null>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeDto[]>([]);

  // Independent of the overview polling below — the live SSE checkin payload only carries the
  // ticket_type catalog key (see checkin-sse-publish.ts), so the page needs its own catalog fetch
  // to resolve it to a label/color for the activity feed's not-yet-reconciled live rows, same
  // convention as CheckInPage/AttendeesPage.
  useEffect(() => {
    const ac = new AbortController();
    fetchTicketTypes(event.id, ac.signal)
      .then((types) => {
        if (ac.signal.aborted) return;
        setTicketTypes(types);
      })
      .catch(() => {
        if (!ac.signal.aborted) setTicketTypes([]);
      });
    return () => ac.abort();
  }, [event.id]);

  const currentOverview = overview?.event.id === event.id ? overview : null;
  const eventTimezone = currentOverview?.event.timezone ?? event.timezone;
  const eventDateIso = currentOverview?.event.date ?? event.date;

  const absorbServerOverview = useCallback((data: EventOverviewDto) => {
    if (data.event.id !== currentEventIdRef.current) return;
    pruneAdmitDedupMap(seenCheckinsRef.current);
    setOverview(data);
    setOptimisticAdmittedDelta(0);
    setContacts(data.contacts);
    setResources(data.resources);
    setPinnedNote(data.event.pinned_note);
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

  useEventStream(event.id, handleLiveCheckin);

  const handleSaveNote = useCallback(async (note: string | null) => {
    const capturedEventId = event.id;
    try {
      await patchEventNote(capturedEventId, note);
      if (currentEventIdRef.current !== capturedEventId) return;
      setPinnedNote(note);
    } catch (err) {
      addToast("Failed to save note.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleAddContact = useCallback(async (data: Parameters<typeof createEventContact>[1]) => {
    const capturedEventId = event.id;
    try {
      const created = await createEventContact(capturedEventId, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setContacts((prev) => [...prev, created]);
    } catch (err) {
      addToast("Failed to add contact.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleUpdateContact = useCallback(async (id: string, data: Parameters<typeof updateEventContact>[2]) => {
    const capturedEventId = event.id;
    try {
      const updated = await updateEventContact(capturedEventId, id, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setContacts((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      addToast("Failed to update contact.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleDeleteContact = useCallback(async (id: string) => {
    const capturedEventId = event.id;
    try {
      await deleteEventContact(capturedEventId, id);
      if (currentEventIdRef.current !== capturedEventId) return;
      setContacts((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      addToast("Failed to delete contact.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleAddResource = useCallback(async (data: Parameters<typeof createEventResource>[1]) => {
    const capturedEventId = event.id;
    try {
      const created = await createEventResource(capturedEventId, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setResources((prev) => [...prev, created]);
    } catch (err) {
      addToast("Failed to add link.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleUpdateResource = useCallback(async (id: string, data: Parameters<typeof updateEventResource>[2]) => {
    const capturedEventId = event.id;
    try {
      const updated = await updateEventResource(capturedEventId, id, data);
      if (currentEventIdRef.current !== capturedEventId) return;
      setResources((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      addToast("Failed to update link.", "error");
      throw err;
    }
  }, [event.id, addToast]);

  const handleDeleteResource = useCallback(async (id: string) => {
    const capturedEventId = event.id;
    try {
      await deleteEventResource(capturedEventId, id);
      if (currentEventIdRef.current !== capturedEventId) return;
      setResources((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      addToast("Failed to delete link.", "error");
      throw err;
    }
  }, [event.id, addToast]);

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
    setContacts([]);
    setResources([]);
    setPinnedNote(null);

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

  const admittedCount =
    currentOverview?.admitted_count != null
      ? currentOverview.admitted_count + optimisticAdmittedDelta
      : null;
  const countdownLabel = useCountdown(eventDateIso, eventTimezone);
  const daysUntil = daysUntilEvent(eventDateIso, eventTimezone);
  // computeLabel() itself falls back to the plain calendar date for anything more than a week out
  // (fine for the header's prose chip, wrong for this numeric tile — it would just repeat the date
  // already shown in the page header). Show the raw day count instead beyond that week window, on
  // either side (future or already-past) — symmetric so a long-over event doesn't read as a full
  // sentence next to a clean number for upcoming ones. The short phrasings for everything within a
  // week ("Today"/"Tomorrow"/"Yesterday"/"In N days"/"Ended N days ago") already read fine as-is.
  const countdownValue =
    daysUntil != null && Math.abs(daysUntil) > 7 ? String(Math.abs(daysUntil)) : countdownLabel;
  // No sub-line (it broke KPI row icon alignment — this was the only tile with a 3rd line).
  // Label mirrors countdownValue's own bare-number/prose split above: "Days to/since event" only
  // once the value is a bare number that needs a unit — a prose value ("In 7 days", "Ended 3 days
  // ago") already states its own direction, so the label stays a neutral "Event countdown" instead
  // of repeating "days" or contradicting which way that value points.
  let daysToEventLabel: string;
  if (daysUntil == null || Math.abs(daysUntil) <= 7) {
    daysToEventLabel = "Event countdown";
  } else if (daysUntil < 0) {
    daysToEventLabel = "Days since event";
  } else {
    daysToEventLabel = "Days to event";
  }
  const emailFailedTotal =
    currentOverview != null
      ? currentOverview.email_failed + currentOverview.email_bounced
      : 0;

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // these "Loading…" placeholders on and off faster than they can register as loading —
  // show them only once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

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
        <OverviewKpiTile
          tone="primary"
          icon={<i className="ti ti-users" aria-hidden="true" />}
          label="Attendees"
          // No raw event.attendee_count fallback here on purpose (#374) — that picker total
          // includes revoked attendees, so falling back to it flashed a higher number (e.g.
          // 5 -> 4) the instant the real active-only overview count arrived.
          value={kpiCountText(currentOverview?.attendee_count ?? null, loading, showLoading)}
        />
        <OverviewKpiTile
          tone="info"
          icon={<i className="ti ti-mail-check" aria-hidden="true" />}
          label="Tickets sent"
          value={kpiCountText(currentOverview?.email_sent ?? null, loading, showLoading)}
        />
        {/* Replaces the former "Checked in" tile (#E1) — that duplicated the admission
         * count/percentage already shown prominently in the Check-in progress card directly
         * below, so this slot now carries information the KPI row didn't have yet. Reuses the
         * existing event-countdown util (computeLabel/useCountdown, added for #160, previously
         * wired into the now-merged EventInfoCard) rather than reimplementing the date math. */}
        <OverviewKpiTile
          tone="ok"
          icon={<i className="ti ti-calendar-event" aria-hidden="true" />}
          label={daysToEventLabel}
          value={countdownValue}
        />
        <OverviewKpiTile
          tone="error"
          icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
          label="Failed delivery"
          value={kpiCountText(currentOverview != null ? emailFailedTotal : null, loading, showLoading)}
        />
      </div>

      <div className="overview-body">
        <div className="overview-row overview-row--stretch">
          <CheckInProgressCard overview={currentOverview} loading={loading} showLoading={showLoading} admittedCount={admittedCount} />
          <RecentActivityCard
            eventId={event.id}
            activity={currentOverview?.recent_activity ?? []}
            liveCheckins={recentCheckins}
            ticketTypes={ticketTypes}
            timezone={eventTimezone}
          />
        </div>
        <div className="overview-row overview-row--stretch">
          <SetupChecklistCard overview={currentOverview} loading={loading} showLoading={showLoading} eventId={event.id} />
          <NotesAndContactsCard
            pinnedNote={pinnedNote}
            loading={loading}
            showLoading={showLoading}
            archived={!!event.archived_at}
            onSaveNote={handleSaveNote}
            contacts={contacts}
            onAddContact={handleAddContact}
            onUpdateContact={handleUpdateContact}
            onDeleteContact={handleDeleteContact}
            resources={resources}
            onAddResource={handleAddResource}
            onUpdateResource={handleUpdateResource}
            onDeleteResource={handleDeleteResource}
          />
        </div>
      </div>
    </div>
  );
}
