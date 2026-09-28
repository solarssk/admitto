import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Input,
  ModalBackdrop,
  Notice,
  PageHeader,
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
  unarchiveEvent,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
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
  formatEventDate,
  formatEventDateTime,
  formatRelativeTime as formatRelativeTimeShared,
  formatUtcDateTime,
  getBrowserTimeZone,
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
import { SearchableSelect } from "../components/SearchableSelect.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";
import { NO_AUTOFILL_PROPS } from "../settings/mailTransportFormParts.js";
import { PhoneCountrySelect } from "../components/PhoneCountrySelect.js";
import { composePhoneE164, splitPhoneForPicker } from "../utils/phoneCountries.js";

const OVERVIEW_REFRESH_MS = 30_000;
const OVERVIEW_SUBTITLE =
  "Track attendance, check-in progress, and setup status for this event.";
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
/** Decorative live signal in card headers. Active look (not a disabled button) with a
 * breathing dot; Overview/Reports have no pause toggle. */
function LiveStatusIndicator() {
  return (
    <output className="overview-live-indicator" aria-label="Live">
      <span className="overview-live-indicator__dot" aria-hidden="true" />
      <span>Live</span>
    </output>
  );
}

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

/** Value and label for the countdown KPI tile.
 * computeLabel() itself falls back to the plain calendar date for anything more than a week out
 * (fine for the header's prose chip, wrong for this numeric tile, it would just repeat the date
 * already shown in the page header), so beyond that window the tile shows the raw day count under a
 * "Days to/since event" label, on either side. Within the week the label stays a neutral
 * "Event countdown" for upcoming events. A past event reads "3 days ago" under "Event ended"
 * instead of "Ended 3 days ago" under "Event countdown": the shorter value fits the tile at the same
 * type size as the other three numbers, and the label still says which way it points. */
function countdownTileText(
  daysUntil: number | null,
  countdownLabel: string,
): { value: string; label: string } {
  if (daysUntil != null && Math.abs(daysUntil) > 7) {
    return { value: String(Math.abs(daysUntil)), label: daysUntil < 0 ? "Days since event" : "Days to event" };
  }
  const ended = /^Ended (.+)$/.exec(countdownLabel)?.[1];
  if (ended) return { value: ended.charAt(0).toUpperCase() + ended.slice(1), label: "Event ended" };
  return { value: countdownLabel, label: "Event countdown" };
}

interface ReadinessItem {
  label: string;
  status: "ok" | "warn" | "error" | "neutral";
  /** Explanatory sentence shown under the label for not-ok items — no reusable readiness widget
   * exists yet under Event settings (checked before building this), so this stays local. */
  detail: string;
  /** Tabler icon name (without the `ti-` prefix) shown in the row's tinted square. */
  icon: string;
  /** Where the row leads, so a problem is one click from the page that fixes it. */
  to: string;
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
function buildReadinessItems(overview: EventOverviewDto, eventId: string): ReadinessItem[] {
  const eventPath = `/admin/events/${eventId}`;
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
      icon: "users",
      to: `${eventPath}/attendees`,
    },
    {
      label: "Tickets sent",
      status: ticketsSent.status,
      detail: ticketsSent.detail,
      icon: "mail-check",
      to: `${eventPath}/communication`,
    },
    {
      label: "Email delivery",
      status: failed === 0 ? "ok" : "error",
      detail: deliveryHealthyDetail,
      icon: failed === 0 ? "mail-opened" : "mail-x",
      to: `${eventPath}/communication`,
    },
    {
      label: "Check-in staff",
      status: overview.checkin_staff_count > 0 ? "ok" : "warn",
      detail: checkinStaffDetail,
      icon: "user-check",
      to: "/admin/users",
    },
    {
      label: "Event items",
      status: "neutral",
      detail: eventItemsDetail,
      icon: "package",
      to: `${eventPath}/requirements`,
    },
  ];
}

/** Placeholder text for a card whose `overview` hasn't arrived yet: blank during the no-flash
 * grace window, "Loading…" once the fetch has genuinely taken a moment, "Unavailable" once it's
 * settled with nothing (shared by SetupChecklistCard and CheckInProgressCard). */
function unavailablePlaceholderText(loading: boolean, showLoading: boolean): string {
  if (loading) return showLoading ? "Loading…" : "";
  return "Unavailable";
}


const READINESS_STATUS_TEXT: Record<ReadinessItem["status"], string> = {
  ok: "Done",
  warn: "Needs attention",
  error: "Problem",
  neutral: "Optional",
};

/** Problems first, so what needs doing is never below the fold. */
const CHECKLIST_ORDER: Record<ReadinessItem["status"], number> = { error: 0, warn: 1, ok: 2, neutral: 3 };

/** One tone for the whole card: red when any check failed, amber when one still needs doing,
 * green once every required check is done. */
function checklistTone(items: ReadinessItem[]): "ok" | "warn" | "error" {
  if (items.some((i) => i.status === "error")) return "error";
  if (items.some((i) => i.status === "warn")) return "warn";
  return "ok";
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
      <Card title="Setup checklist">
        <p className="overview-muted">
          {unavailablePlaceholderText(loading, showLoading)}
        </p>
      </Card>
    );
  }

  const items = buildReadinessItems(overview, eventId);
  const okCount = items.filter((i) => i.status === "ok").length;
  const total = items.filter((i) => i.status !== "neutral").length;
  const attention = total - okCount;
  const tone = checklistTone(items);
  const noticeVariant = { ok: "success", warn: "warning", error: "error" }[tone] as "success" | "warning" | "error";
  let summary = "Everything is ready. Nothing needs your attention.";
  if (attention === 1) summary = "1 item needs your attention.";
  else if (attention > 1) summary = `${attention} items need your attention.`;

  return (
    <Card
      title="Setup checklist"
      actions={
        <span className="overview-readiness-score">
          {okCount} of {total} done
        </span>
      }
    >
      <div className="overview-setup">
        <div
          className={`overview-setup__bar overview-setup__bar--${tone}`}
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={okCount}
        >
          <span style={{ width: `${total > 0 ? (okCount / total) * 100 : 0}%` }} />
        </div>
        <Notice variant={noticeVariant}>{summary}</Notice>
        <div className="overview-checklist">
          {/* Array.sort is stable, so rows of the same status keep their natural order. */}
          {[...items]
            .sort((x, y) => CHECKLIST_ORDER[x.status] - CHECKLIST_ORDER[y.status])
            .map((item) => (
              <Link key={item.label} to={item.to} className="overview-check">
                <span className={`overview-check__icon overview-check__icon--${item.status}`} aria-hidden="true">
                  <i className={`ti ti-${item.icon}`} />
                </span>
                <span className="overview-check__body">
                  <strong>{item.label}</strong>
                  <span className="overview-check__detail">{item.detail}</span>
                </span>
                <span className="sr-only">{READINESS_STATUS_TEXT[item.status]}</span>
                <i className="ti ti-chevron-right overview-check__chevron" aria-hidden="true" />
              </Link>
            ))}
        </div>
      </div>
    </Card>
  );
}

/** Check-in progress card: the ring and the one number that matters (how many are in, and how
 * many are not), plus two small facts. The second fact is the wallet install count when the event
 * uses wallets, otherwise the busiest hour. Anything more detailed (by ticket type, by hour)
 * lives in Reports. `eventEnded` only changes the word for the attendees who never arrived:
 * "not yet arrived" while the event can still fill up, "no-shows" once it is over. */
function CheckInProgressCard({
  overview,
  loading,
  showLoading,
  admittedCount,
  eventEnded,
}: Readonly<{
  overview: EventOverviewDto | null;
  loading: boolean;
  showLoading: boolean;
  admittedCount: number | null;
  eventEnded: boolean;
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
  // --border-strong (~1.5:1 against white) rather than a --text-muted-based mix: a clearly lighter,
  // purely structural track so the "not yet" part of the ring reads as neutral. Under the 3:1
  // floor is acceptable because the numbers next to the ring already say the same thing in text.
  const notYetColor = "var(--border-strong)";
  // A stale apps/web dev process (no watch mode) from before this field existed omits it: treat
  // that the same as "wallets not in use" instead of crashing the whole page.
  const walletInstalled = overview.wallet_installed ?? null;
  const walletPct = walletInstalled != null && total > 0 ? Math.round((walletInstalled / total) * 100) : 0;
  let notYetText = `${notYet} not yet arrived`;
  if (eventEnded) notYetText = `${notYet} ${notYet === 1 ? "no-show" : "no-shows"}`;

  // A ring at a permanent 0% is noise, not information, when there's nobody to check in yet:
  // same icon+text placeholder treatment as Recent activity's empty state instead.
  const body =
    total === 0 ? (
      <EmptyState
        icon={<i className="ti ti-users" aria-hidden="true" />}
        title="No attendees yet"
        description="Import attendees to start tracking check-ins."
      />
    ) : (
      <div className="overview-checkin">
        <div className="overview-checkin__hero">
          <div
            className="overview-ring"
            style={{
              background: `conic-gradient(var(--status-ok) 0% ${pct}%, ${notYetColor} ${pct}% 100%)`,
            }}
            role="img"
            aria-label={`${pct}% of attendees checked in`}
          >
            <div className="overview-ring__hole">
              <span className="overview-ring__pct">{pct}%</span>
            </div>
          </div>
          <div className="overview-checkin__figure">
            <span className="overview-checkin__count">{admitted}</span>
            <span className="overview-checkin__caption">checked in</span>
            <span className="overview-checkin__rest">{notYetText}</span>
          </div>
        </div>

        <div className="overview-glance">
          <div className="overview-glance__tile">
            <span className="overview-glance__icon" aria-hidden="true">
              <i className="ti ti-clock" />
            </span>
            <span className="overview-glance__text">
              <span className="overview-glance__label">Last check-in</span>
              <span className="overview-glance__value">{formatRelativeTime(overview.last_check_in_at)}</span>
            </span>
          </div>
          {walletInstalled == null ? (
            <div className="overview-glance__tile">
              <span className="overview-glance__icon" aria-hidden="true">
                <i className="ti ti-trending-up" />
              </span>
              <span className="overview-glance__text">
                <span className="overview-glance__label">Busiest hour</span>
                <span className="overview-glance__value">
                  {overview.busiest_hour ? formatBusiestHourRange(overview.busiest_hour.hour) : "-"}
                </span>
              </span>
            </div>
          ) : (
            <div className="overview-glance__tile">
              <span className="overview-glance__icon overview-glance__icon--wallet" aria-hidden="true">
                <i className="ti ti-wallet" />
              </span>
              <span className="overview-glance__text">
                <span className="overview-glance__label">Wallet passes installed</span>
                <span className="overview-glance__value">
                  {walletInstalled} <span className="overview-glance__aside">({walletPct}%)</span>
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
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
  attendee_added: "ti-user-plus",
  item_issued: "ti-package",
  item_returned: "ti-package",
  item_revoked: "ti-arrow-back-up",
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
    // This browser is the one that just scanned - its own zone is the real actor zone, not a
    // guess, unlike the null-and-fall-back-to-viewer case the server-sourced rows use.
    actor_timezone: getBrowserTimeZone(),
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
 * check-ins, mail failures/bounces, imports, attendees added, and item issue/return, with an
 * All/Issues filter. */
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
        description="Check-ins, emails, and imports will appear here."
      />
    );

  return (
    <Card
      title="Recent activity"
      className="overview-card--header-fixed overview-card--timeline"
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
          {/* Decorative success Live button (role=status), matching Org Settings Logs —
           * always rendered as a static design element, not gated on the SSE handshake. */}
          <LiveStatusIndicator />
        </>
      }
    >
      {/* Fixed-height scroll container (staff.css .overview-timeline) always renders, even for
       * the 0/1-item case, so the card's footprint never shrinks when the All/Issues filter
       * narrows the result set. Zero matches get a real centered empty state (not a top-left
       * paragraph over dead space) via the shared EmptyState component (#A2). */}
      <div className={`overview-timeline at-scroll${filtered.length === 0 ? " overview-timeline--empty" : ""}`}>
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
                        {formatEventDateTime(entry.occurred_at, entry.actor_timezone ?? timezone)}
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
  iconClass,
  description,
  onClose,
  footer,
  children,
}: Readonly<{
  titleId: string;
  title: string;
  iconClass: string;
  description: string;
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
          <i className={`ti ${iconClass}`} aria-hidden="true" />
          {title}
        </h2>
        <p className="overview-modal__subtitle">{description}</p>
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
  const dirty = draft.trim() !== (note ?? "").trim();

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
      iconClass="ti-pin"
      description="Shown to all staff on this overview. Use for day-of instructions."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void handleSave()} disabled={saving || !dirty}>
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
  const initialPhone = splitPhoneForPicker(contact?.phone ?? "");
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    email: contact?.email ?? "",
  });
  const [phoneCountryCode, setPhoneCountryCode] = useState(initialPhone.dialCode);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone.nationalNumber);
  const [saving, setSaving] = useState(false);
  const dirty =
    form.name.trim() !== (contact?.name ?? "") ||
    form.role.trim() !== (contact?.role ?? "") ||
    form.email.trim() !== (contact?.email ?? "") ||
    phoneCountryCode !== initialPhone.dialCode ||
    phoneNumber !== initialPhone.nationalNumber;

  const handleSubmit = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        role: form.role.trim() || null,
        phone: composePhoneE164(phoneCountryCode, phoneNumber) || null,
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
      iconClass="ti-address-book"
      description="Add a key person staff can reach during the event."
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
            disabled={saving || !form.name.trim() || !dirty}
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
      />
      <Input
        label="Role"
        icon={<i className="ti ti-briefcase" aria-hidden="true" />}
        value={form.role}
        onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
      />
      <div className="overview-contact-modal__field">
        <label htmlFor="overview-contact-phone-number" className="at-label">
          Phone number
        </label>
        <div className="overview-contact-modal__phone-row">
          <PhoneCountrySelect
            id="overview-contact-phone-country-code"
            label="Phone country code"
            value={phoneCountryCode}
            disabled={saving}
            onChange={setPhoneCountryCode}
          />
          <Input
            id="overview-contact-phone-number"
            icon={<i className="ti ti-phone" aria-hidden="true" />}
            type="tel"
            name="event-contact-phone"
            value={phoneNumber}
            disabled={saving}
            onChange={(e) => setPhoneNumber(e.target.value)}
            {...NO_AUTOFILL_PROPS}
          />
        </div>
      </div>
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
    type: resource?.type ?? ("link"),
    url: resource?.url ?? "",
    description: resource?.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const dirty =
    form.title.trim() !== (resource?.title ?? "") ||
    form.type !== (resource?.type ?? "link") ||
    form.url.trim() !== (resource?.url ?? "") ||
    form.description.trim() !== (resource?.description ?? "");

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
      iconClass="ti-link"
      description="Share a useful link or file reference with staff on this overview."
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
            disabled={saving || !form.title.trim() || !form.url.trim() || !dirty}
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
      />
      <div className="at-field">
        <label className="at-label" htmlFor="overview-resource-type">
          Type
        </label>
        <SearchableSelect
          id="overview-resource-type"
          label="Type"
          placeholder="Select type…"
          searchPlaceholder="Search types…"
          emptyLabel="No types found"
          showLabel={false}
          value={form.type}
          options={[
            { id: "link", label: "Link" },
            { id: "file", label: "File" },
          ]}
          onChange={(id) => setForm((f) => ({ ...f, type: id as "link" | "file" }))}
        />
      </div>
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
    <Card title="Notes & contacts">
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
  const { event, refreshEvent } = useOutletContext<{
    event: EventDto;
    refreshEvent?: () => Promise<void>;
  }>();
  const { reportApiError } = useConnectionState();
  const { addToast } = useToast();
  const { assignments } = useAuth();
  // Unarchiving is a superadmin-only API (POST /events/:id/unarchive), so only they get the button.
  const canRestore = isSuperadmin(assignments);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
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

  // Bounded, not a plain reset-on-every-call debounce: a pending timer is left alone rather than
  // restarted, so a steady stream of signals (busy handout desk issuing items back-to-back) still
  // reconciles within ~3s of the *first* one instead of only after a quiet gap - important since
  // activity_changed (unlike checkin) has no optimistic local render to fall back on in between.
  const scheduleReconcile = useCallback(() => {
    if (reconcileTimerRef.current != null) return;
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

  useEventStream(event.id, handleLiveCheckin, scheduleReconcile);

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
            addToast("Could not load event stats.", "error");
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
  const { value: countdownValue, label: daysToEventLabel } = countdownTileText(daysUntil, countdownLabel);
  const emailFailedTotal =
    currentOverview != null
      ? currentOverview.email_failed + currentOverview.email_bounced
      : 0;

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // these "Loading…" placeholders on and off faster than they can register as loading —
  // show them only once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

  // This page stays mounted when the route moves to another event, so a restore still in flight
  // must not touch the dialog or the layout of the event that is now showing.
  useEffect(() => {
    setRestoreOpen(false);
    setRestoreError(null);
    setRestoring(false);
  }, [event.id]);

  const handleRestore = async () => {
    const restoringId = event.id;
    const stillHere = () => currentEventIdRef.current === restoringId;
    setRestoring(true);
    setRestoreError(null);
    try {
      await unarchiveEvent(restoringId);
      addToast("Event restored.", "success");
      if (!stillHere()) return;
      setRestoreOpen(false);
      await refreshEvent?.();
    } catch (err) {
      // Shown inside the still-open dialog (errorMessage), not a toast - the dialog's backdrop
      // sits above the toast stack, so a toast-only failure would be invisible behind it.
      if (stillHere()) setRestoreError(operatorApiErrorMessage(err, "Could not restore the event."));
    } finally {
      if (stillHere()) setRestoring(false);
    }
  };

  return (
    <div className="screen">
      <PageHeader title="Overview" subtitle={OVERVIEW_SUBTITLE} />

      {event.archived_at && (
        <Notice
          variant="warning"
          icon="archive"
          action={
            canRestore ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<i className="ti ti-archive-off" aria-hidden="true" />}
                onClick={() => setRestoreOpen(true)}
              >
                Restore event
              </Button>
            ) : undefined
          }
        >
          This event is archived. Data is kept, but editing and check-in are locked. Archived on{" "}
          {event.archived_by_timezone
            ? formatEventDateTime(event.archived_at, event.archived_by_timezone)
            : formatUtcDateTime(event.archived_at)}
          .{canRestore ? "" : " Ask a superadmin to restore it."}
        </Notice>
      )}

      <ConfirmDialog
        open={restoreOpen}
        icon={<i className="ti ti-archive-off" />}
        title="Restore this event?"
        message={`"${event.title}" will become active again. Editing and check-in will be allowed, and it will show up in default event lists.`}
        confirmLabel="Restore event"
        loading={restoring}
        errorMessage={restoreError}
        onConfirm={() => void handleRestore()}
        onCancel={() => {
          if (!restoring) {
            setRestoreOpen(false);
            setRestoreError(null);
          }
        }}
      />

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
          // Distinct attendees who got their ticket, not raw email_sent: that counts every
          // delivered mail (resends, reminders, other templates), so it can exceed attendee_count.
          value={kpiCountText(currentOverview?.attendees_with_ticket ?? null, loading, showLoading)}
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
          <CheckInProgressCard
            overview={currentOverview}
            loading={loading}
            showLoading={showLoading}
            admittedCount={admittedCount}
            eventEnded={daysUntil != null && daysUntil < 0}
          />
          <RecentActivityCard
            eventId={event.id}
            activity={currentOverview?.recent_activity ?? []}
            liveCheckins={recentCheckins}
            ticketTypes={ticketTypes}
            timezone={getBrowserTimeZone()}
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
