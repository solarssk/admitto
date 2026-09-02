import { memo } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Card, EmptyState } from "@admitto/ui";
import { fetchEventMailReports } from "../api/client.js";
import type { EventMailReportsResponse } from "../api/types.js";
import { useReportFetch } from "../hooks/useReportFetch.js";
import { BreakdownRows, pctOf, type BreakdownRow } from "./ReportsPage.js";
import { niceCountAxis, yAxisWidthForCount } from "./WalletsReportsTab.js";
// This tab's own cards reuse the .wallets-* card/chart primitives from reports-page.css (the
// de facto shared vocabulary for any donut/gauge report card in this feature, despite the name -
// see WalletsReportsTab.tsx/CustomFieldsReportsTab.tsx) - imported directly here too, per this
// app's own every-consumer-imports-its-own-CSS convention (AGENTS.md's lazy-chunk gotcha).
import "./reports-page.css";

// Literal hex, not var(--token) - Recharts renders as plain SVG, and a CSS custom property in an
// SVG presentation attribute (fill=) doesn't resolve consistently across browsers, same
// constraint as WalletsReportsTab.tsx's own PRIMARY/GRAY_400 constants.
const PRIMARY = "#066fd1"; // --primary / --at-blue
const STATUS_OK = "#2fb344"; // --status-ok / --at-green
const DANGER_RED = "#d63939"; // --at-red / --status-error
const GRAY_400 = "#94a3b8"; // --at-gray-400
const TEXT_MUTED = "#64748b"; // --text-muted / --at-gray-500
const BORDER = "#e6e7e9"; // --border
const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"; // --font-sans

type MailStatus = EventMailReportsResponse["delivery"]["by_status"][number]["status"];
const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  accepted: "Accepted",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  bounced: "Bounced",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
// queued and cancelled are both "no successful send yet", but for very different reasons (still
// in progress vs. given up on) - amber vs. gray keeps them visually distinct in the breakdown
// list instead of reading as the same bucket at a glance.
const WARN_AMBER = "#f59f00"; // --at-yellow
const STATUS_COLORS: Record<string, string> = {
  queued: WARN_AMBER,
  accepted: STATUS_OK,
  sent: STATUS_OK,
  delivered: STATUS_OK,
  failed: DANGER_RED,
  bounced: DANGER_RED,
  rejected: DANGER_RED,
  cancelled: GRAY_400,
};

/** Same fix as WalletsReportsTab.tsx's own preventFocusRing: a plain mouse click on a Recharts
 * root <svg> focuses it (its own built-in keyboard-accessibility layer), showing a raw focus ring
 * the CSS `:focus` suppression doesn't reliably catch across every browser. Preventing the
 * mousedown's default action stops focus from moving there at all on a click; a real Tab keypress
 * still focuses and shows the ring normally. */
function preventFocusRing(event: ReactMouseEvent) {
  event.preventDefault();
}

interface DonutSlice {
  label: string;
  color: string;
  count: number;
}

/** Donut for a mutually-exclusive breakdown (delivery status, reached vs not reached, viewed vs
 * not viewed) - mirrors WalletsReportsTab.tsx's PlatformDonut/WalletLifecycleDonut shape (HTML
 * center-label overlay in place of Recharts' own per-slice label). A single-ring "success %"
 * gauge doesn't represent a 3+-category breakdown at all (the other categories just read as
 * "empty track"), so every breakdown on this tab uses this same full-donut shape instead, even
 * where there are only two categories. `isActive` gates whether ResponsiveContainer (and the
 * ResizeObserver it installs) actually mounts - this tab stays mounted with display:none on the
 * other Reports tabs (ReportsPage.tsx), and an observer left watching a box that just collapsed
 * to 0x0 is what triggers Recharts' own "width(0) and height(0)" console warning. */
function SliceDonut({
  slices,
  centerValue,
  centerLabel,
  unit,
  isActive,
}: Readonly<{ slices: DonutSlice[]; centerValue: number; centerLabel: string; unit: string; isActive: boolean }>) {
  return (
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      className="wallets-gauge-overlay"
      role="presentation"
      onMouseDown={preventFocusRing}
    >
      {isActive && (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart style={{ fontFamily: FONT_FAMILY }}>
            <Pie
              data={slices}
              dataKey="count"
              nameKey="label"
              innerRadius="58%"
              outerRadius="90%"
              stroke="#ffffff"
              strokeWidth={2}
              label={false}
              labelLine={false}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.label} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => `${value} ${unit}${value === 1 ? "" : "s"}`} position={{ y: 256 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="wallets-gauge-overlay__center">
        <span className="wallets-gauge-overlay__value">{centerValue}</span>
        <span className="wallets-gauge-overlay__label">{centerLabel}</span>
      </div>
    </div>
  );
}

/** Area chart of successful sends over time - same Recharts shape as WalletsReportsTab.tsx's own
 * CumulativeChart (a hand-rolled version had real axis bugs there; a real charting library avoids
 * both), reusing its niceCountAxis/yAxisWidthForCount helpers so a small event's send count still
 * gets whole-number axis ticks instead of Recharts' own fractional default. */
function SentOverTimeChart({
  data,
  isActive,
}: Readonly<{ data: EventMailReportsResponse["sent_by_day"]; isActive: boolean }>) {
  if (data.length === 0) {
    return (
      <EmptyState
        icon={<i className="ti ti-chart-line" aria-hidden="true" />}
        title="Nothing sent successfully yet"
        description="This chart fills in once at least one email is delivered successfully."
      />
    );
  }

  // Noon UTC, not midnight - a date-only value pinned to midnight can render as the previous
  // calendar day once the chart formats it in the viewer's own local timezone.
  const points = data.map((d) => ({ date: Date.parse(`${d.date}T12:00:00Z`), value: d.cumulative }));
  points.unshift({ date: points[0]!.date - 24 * 60 * 60 * 1000, value: 0 });
  const { axisMax, tickAmount } = niceCountAxis(data.at(-1)!.cumulative);
  const yTicks = Array.from({ length: tickAmount + 1 }, (_, i) => (i * axisMax) / tickAmount);
  const dayFormatter = (ts: number) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(ts);
  return (
    <div // NOSONAR — mousedown-only, see preventFocusRing above; not an interactive element itself
      role="presentation"
      className="wallets-chart-card__chart"
      onMouseDown={preventFocusRing}
    >
      {/* isActive-gated mount, same reasoning as SliceDonut above - this chart's card stays
          mounted with display:none on every other Reports tab (ReportsPage.tsx's sticky-mount),
          and a ResponsiveContainer left mounted there keeps its ResizeObserver watching a box
          that just collapsed to 0x0, which is exactly when Recharts logs its own "width(0) and
          height(0)" console warning on every subsequent tab switch. */}
      {isActive && (
        <ResponsiveContainer width="100%" height="100%" minHeight={230}>
          <AreaChart data={points} style={{ fontFamily: FONT_FAMILY }}>
            <defs>
              <linearGradient id="mail-cumulative-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.3} />
                <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={BORDER} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={dayFormatter}
              tick={{ fontSize: 11, fill: TEXT_MUTED }}
              axisLine={{ stroke: BORDER }}
              tickLine={{ stroke: BORDER }}
            />
            <YAxis
              domain={[0, axisMax]}
              ticks={yTicks}
              tickFormatter={(v) => Math.round(Number(v)).toString()}
              tick={{ fontSize: 11, fill: TEXT_MUTED }}
              width={yAxisWidthForCount(axisMax)}
            />
            <Tooltip
              labelFormatter={(label) =>
                new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
                  Number(label),
                )
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              name="Successful sends"
              stroke={PRIMARY}
              strokeWidth={2.5}
              fill="url(#mail-cumulative-fill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function statusSlices(byStatus: EventMailReportsResponse["delivery"]["by_status"]): DonutSlice[] {
  return byStatus.map((row) => ({
    label: STATUS_LABELS[row.status as MailStatus] ?? row.status,
    color: STATUS_COLORS[row.status as MailStatus] ?? GRAY_400,
    count: row.count,
  }));
}

function statusBreakdownRows(byStatus: EventMailReportsResponse["delivery"]["by_status"], total: number): BreakdownRow[] {
  return byStatus.map((row) => ({
    id: row.status,
    label: STATUS_LABELS[row.status as MailStatus] ?? row.status,
    meta: `${row.count} · ${pctOf(row.count, total)}%`,
    pct: pctOf(row.count, total),
    color: STATUS_COLORS[row.status as MailStatus] ?? GRAY_400,
  }));
}

function reachSlices(reach: EventMailReportsResponse["attendee_reach"]): DonutSlice[] {
  return [
    { label: "Reached", color: STATUS_OK, count: reach.reached },
    { label: "Not reached", color: DANGER_RED, count: reach.not_reached },
  ];
}

function reachBreakdownRows(reach: EventMailReportsResponse["attendee_reach"], total: number): BreakdownRow[] {
  return reachSlices(reach).map((slice) => ({
    id: slice.label,
    label: slice.label,
    meta: `${slice.count} · ${pctOf(slice.count, total)}%`,
    pct: pctOf(slice.count, total),
    color: slice.color,
  }));
}

function purposeRows(byPurpose: EventMailReportsResponse["by_purpose"], total: number): BreakdownRow[] {
  return [
    { id: "initial", label: "Initial", meta: `${byPurpose.initial} · ${pctOf(byPurpose.initial, total)}%`, pct: pctOf(byPurpose.initial, total), color: PRIMARY },
    { id: "resend", label: "Resend", meta: `${byPurpose.resend} · ${pctOf(byPurpose.resend, total)}%`, pct: pctOf(byPurpose.resend, total), color: GRAY_400 },
  ];
}

function templateRows(byTemplate: EventMailReportsResponse["by_template"]): BreakdownRow[] {
  return byTemplate.map((row) => ({
    id: row.template ?? "__default__",
    label: row.template ?? "Default ticket email",
    meta: `${row.successful} of ${row.total} · ${row.successful_pct}%`,
    pct: row.successful_pct,
    color: PRIMARY,
  }));
}

function viewedSlices(viewed: EventMailReportsResponse["ticket_viewed"]): DonutSlice[] {
  return [
    { label: "Opened ticket page", color: PRIMARY, count: viewed.viewed },
    { label: "Not opened yet", color: GRAY_400, count: viewed.reached - viewed.viewed },
  ];
}

function viewedBreakdownRows(viewed: EventMailReportsResponse["ticket_viewed"]): BreakdownRow[] {
  return viewedSlices(viewed).map((slice) => ({
    id: slice.label,
    label: slice.label,
    meta: `${slice.count} · ${pctOf(slice.count, viewed.reached)}%`,
    pct: pctOf(slice.count, viewed.reached),
    color: slice.color,
  }));
}

// Memoized and kept mounted once visited, same reasoning as WalletsReportsTab.tsx/
// CustomFieldsReportsTab.tsx: ReportsPage re-renders on every live check-in (Event Day's SSE
// feed), and this tab stays mounted underneath even while Event Day is the visible one.
// `isActive` still changes on tab switch though, and memo's shallow prop comparison re-renders on
// that - each chart only mounts its ResponsiveContainer while isActive is true (see SliceDonut's
// own comment).
export const MailReportsTab = memo(function MailReportsTab({
  eventId,
  isActive,
}: Readonly<{ eventId: string; isActive: boolean }>) {
  const { data, loading, error, showLoadingSkeleton, retry } = useReportFetch(
    fetchEventMailReports,
    eventId,
    "Could not load mail report.",
  );

  if (loading && showLoadingSkeleton) {
    return <p className="wallets-description">Loading mail report…</p>;
  }

  if (!loading && error) {
    return (
      <EmptyState
        icon={<i className="ti ti-alert-triangle" aria-hidden="true" />}
        title="Could not load mail report"
        description={error}
        action={
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data) return null;

  if (data.delivery.total_attempts === 0) {
    return (
      <EmptyState
        icon={<i className="ti ti-mail-off" aria-hidden="true" />}
        title="No emails sent yet"
        description="This tab fills in once ticket emails start going out for this event."
      />
    );
  }

  return (
    <>
      <div className="wallets-panels">
        <Card title="Email delivery">
          <p className="wallets-description">
            Every attempt to send an email for this event, including resends. A resend counts as a new attempt, so this is attempts, not attendees.
          </p>
          <div className="wallets-adoption">
            <SliceDonut
              slices={statusSlices(data.delivery.by_status)}
              centerValue={data.delivery.successful}
              centerLabel="successful"
              unit="attempt"
              isActive={isActive}
            />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={statusBreakdownRows(data.delivery.by_status, data.delivery.total_attempts)} />
            </div>
          </div>
        </Card>
        <Card title="Attendee reach">
          <p className="wallets-description">
            Attendees who got at least one email successfully, no matter how many attempts it took.
          </p>
          <div className="wallets-adoption">
            <SliceDonut
              slices={reachSlices(data.attendee_reach)}
              centerValue={data.attendee_reach.reached}
              centerLabel="reached"
              unit="attendee"
              isActive={isActive}
            />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={reachBreakdownRows(data.attendee_reach, data.total_attendees)} />
            </div>
          </div>
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Initial vs resend" className="wallets-list-card">
          <p className="wallets-description">
            Every delivery attempt for this event, split into first tries and resends.
          </p>
          <BreakdownRows rows={purposeRows(data.by_purpose, data.delivery.total_attempts)} />
        </Card>
        <Card title="Delivery by template" className="wallets-list-card">
          <p className="wallets-description">Success rate for each email template sent to this event&rsquo;s attendees.</p>
          <BreakdownRows rows={templateRows(data.by_template)} />
        </Card>
      </div>

      <div className="wallets-panels">
        <Card title="Emails sent over time" className="wallets-chart-card">
          <p className="wallets-description">The running total of emails successfully sent over time.</p>
          <SentOverTimeChart data={data.sent_by_day} isActive={isActive} />
        </Card>
        <Card title="Ticket page opened">
          <p className="wallets-description">
            How many reached attendees opened their ticket page online. This tracks the ticket link, not whether the email itself was opened.
          </p>
          <div className="wallets-adoption">
            <SliceDonut
              slices={viewedSlices(data.ticket_viewed)}
              centerValue={data.ticket_viewed.viewed}
              centerLabel="opened page"
              unit="attendee"
              isActive={isActive}
            />
            <div className="wallets-adoption__breakdown">
              <BreakdownRows rows={viewedBreakdownRows(data.ticket_viewed)} />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
});
