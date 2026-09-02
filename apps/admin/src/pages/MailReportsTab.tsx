import { memo } from "react";
import { Button, Card, EmptyState } from "@admitto/ui";
import { fetchEventMailReports } from "../api/client.js";
import type { EventMailReportsResponse } from "../api/types.js";
import { useReportFetch } from "../hooks/useReportFetch.js";
import { BreakdownRows, pctOf, type BreakdownRow } from "./ReportsPage.js";
import {
  ReportsAdmissionCompare,
  ReportsCumulativeAreaChart,
  ReportsDonutChart,
  type ReportsDonutSlice,
} from "./reports-charts.js";
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

function statusSlices(byStatus: EventMailReportsResponse["delivery"]["by_status"]): ReportsDonutSlice[] {
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

function reachSlices(reach: EventMailReportsResponse["attendee_reach"]): ReportsDonutSlice[] {
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

function viewedSlices(viewed: EventMailReportsResponse["ticket_viewed"]): ReportsDonutSlice[] {
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

/** Four sequential attendee-journey counts, each as its own share of the whole attendee list -
 * deliberately not a strictly narrowing conversion funnel, since a later stage can include an
 * attendee who skipped an earlier one (e.g. a wallet pass installed by someone email never
 * reached another way, or an attendee admitted at the door without ever installing a pass).
 * Forcing every stage to only ever shrink would misrepresent that real, sometimes non-monotonic
 * event journey. Rendered as a connected vertical stepper (dot + line per stage), not the
 * BreakdownRows list every other card here uses - that list reads as a category legend (the same
 * shape as "Delivery by template"), which lost the sense of sequence this card exists to show. A
 * stepper is the standard UI pattern for ordered steps and needs no horizontal space, so unlike an
 * earlier arrow-row version it can't wrap into a confusing layout on a narrow mobile card. */
function EventJourneyFunnel({ funnel }: Readonly<{ funnel: EventMailReportsResponse["funnel"] }>) {
  const stages = [
    { id: "attendees", label: "Attendees", value: funnel.total_attendees },
    { id: "reached", label: "Reached by email", value: funnel.reached_by_email },
    { id: "wallet", label: "Wallet installed", value: funnel.wallet_installed },
    { id: "attended", label: "Attended", value: funnel.attended },
  ];
  return (
    <div className="mail-funnel">
      {stages.map((stage) => (
        <div className="mail-funnel__row" key={stage.id}>
          <div className="mail-funnel__rail">
            <span className="mail-funnel__dot" aria-hidden="true" />
            <span className="mail-funnel__line" aria-hidden="true" />
          </div>
          <div className="mail-funnel__body">
            <div className="mail-funnel__head">
              <span className="mail-funnel__label">{stage.label}</span>
              <span className="mail-funnel__value">{stage.value}</span>
            </div>
            <span className="mail-funnel__pct">{pctOf(stage.value, funnel.total_attendees)}% of attendees</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Memoized and kept mounted once visited, same reasoning as WalletsReportsTab.tsx/
// CustomFieldsReportsTab.tsx: ReportsPage re-renders on every live check-in (Event Day's SSE
// feed), and this tab stays mounted underneath even while Event Day is the visible one.
// `isActive` still changes on tab switch though, and memo's shallow prop comparison re-renders on
// that - each chart only mounts its ResponsiveContainer while isActive is true (see
// ReportsDonutChart's own comment in reports-charts.tsx).
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
            <ReportsDonutChart
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
            <ReportsDonutChart
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
          {data.sent_by_day.length === 0 ? (
            <EmptyState
              icon={<i className="ti ti-chart-line" aria-hidden="true" />}
              title="Nothing sent successfully yet"
              description="This chart fills in once at least one email is delivered successfully."
            />
          ) : (
            <ReportsCumulativeAreaChart
              data={data.sent_by_day}
              gradientId="mail-cumulative-fill"
              seriesName="Successful sends"
              isActive={isActive}
            />
          )}
        </Card>
        <Card title="Ticket page opened">
          <p className="wallets-description">
            How many reached attendees opened their ticket page online. This tracks the ticket link, not whether the email itself was opened.
          </p>
          <div className="wallets-adoption">
            <ReportsDonutChart
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

      <div className="wallets-panels">
        <Card title="Admission rate by email status" className="wallets-card--centered">
          <ReportsAdmissionCompare
            description="Check-in rate compared between attendees email reached and attendees it didn’t."
            withLabel="Reached by email"
            withGroup={data.admission_by_email.reached}
            withoutLabel="Not reached by email"
            withoutGroup={data.admission_by_email.not_reached}
            isActive={isActive}
          />
        </Card>
        <Card title="Event journey" className="wallets-card--centered">
          <p className="wallets-description">
            How many attendees reached each stage of the event: got a ticket email, installed a wallet pass, and attended.
          </p>
          <EventJourneyFunnel funnel={data.funnel} />
        </Card>
      </div>
    </>
  );
});
