import type { EnabledWalletPlatforms } from "@admitto/shared";
import { Button, Card, Notice, PageHeader, Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";
import { hasWalletStatusChip } from "./walletStatusChip.js";

/** The status chips every event has, by their real names and icons; what each one says is what the read fills in. */
const STATUS_CHIPS = [
  { icon: "user-check", label: "Pass", badgeWidth: 52 },
  { icon: "calendar-question", label: "Attendance", badgeWidth: 76 },
  { icon: "mail", label: "Ticket delivery", badgeWidth: 64 },
  { icon: "qrcode", label: "Check-in", badgeWidth: 96 },
] as const;

/** The fifth chip, which only an event that offers a wallet platform has (`hasWalletStatusChip`). */
const WALLET_CHIP = { icon: "wallet", label: "Wallet", badgeWidth: 74 } as const;

/** The profile's rows by their real labels, each with a bar the width of a typical value. */
const PROFILE_ROWS = [
  { label: "Email", width: 196 },
  { label: "Ticket type", width: 48 },
  { label: "Company", width: 110 },
  { label: "Department", width: 96 },
  { label: "Added via", width: 120 },
  { label: "Registered on", width: 168 },
] as const;

/** The page's three tabs by their real names, in the order of the strip. */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity log" },
  { id: "notes", label: "Notes" },
] as const;

/** The tab that the address asks for (`?tab=activity`): the page opens on it, so its placeholder is the one drawn. */
export type AttendeeSkeletonTab = (typeof TABS)[number]["id"];

/** The Activity tab's rows: a bar for the headline and one for the detail line under it, of different widths so that the rows do not look stamped. */
const ACTIVITY_ROWS = [
  { id: "first", headline: 132, detail: 208 },
  { id: "second", headline: 96, detail: 164 },
  { id: "third", headline: 148, detail: 232 },
] as const;

/** What the Notes tab says above its composer, the same for every attendee, so it is drawn for real (`AttendeeNotesTab` says it too). */
const NOTES_HINT = "Internal notes are visible to staff only and are never shown to the attendee.";

/** A row of a card whose labels depend on the read (the custom fields): a bar for the label and one for the value. */
function BarsRow({ labelWidth, valueWidth }: Readonly<{ labelWidth: number; valueWidth: number }>) {
  return (
    <div className="attendee-detail-row">
      <Skeleton variant="rect" width={labelWidth} height={14} />
      <Skeleton variant="rect" width={valueWidth} height={14} />
    </div>
  );
}

/** A bar in the place of a line of text: the line is `line` tall, as the text would be, and the bar, `bar` tall, sits in the middle of it. */
function Line({ width, bar, line }: Readonly<{ width: number | string; bar: number; line: number }>) {
  return (
    <div className="attendee-detail-skeleton__line" style={{ height: line }}>
      <Skeleton variant="rect" width={width} height={bar} />
    </div>
  );
}

/** The Overview tab: the cards of the page by their real titles, over rows of bars. */
function OverviewBody() {
  return (
    <div className="attendee-detail-grid attendee-detail-skeleton" aria-hidden="true">
      <div className="attendee-detail-main">
        <Card title="Profile" className="attendee-detail-profile">
          <div className="attendee-detail-readonly">
            {PROFILE_ROWS.map(({ label, width }) => (
              <div className="attendee-detail-row" key={label}>
                <span>{label}</span>
                <Skeleton variant="rect" width={width} height={14} />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Additional information">
          <div className="attendee-detail-readonly">
            <BarsRow labelWidth={88} valueWidth={140} />
            <BarsRow labelWidth={72} valueWidth={104} />
            <BarsRow labelWidth={104} valueWidth={152} />
          </div>
        </Card>
      </div>
      <div className="attendee-detail-side">
        <Card title="Event items">
          <ul className="attendee-items-list">
            <li className="attendee-items-row">
              <Skeleton variant="rect" width={28} height={28} />
              <span className="attendee-items-row__label">
                <Skeleton variant="rect" width={96} height={14} />
              </span>
              <Skeleton variant="rect" width={38} height={18} />
            </li>
          </ul>
        </Card>
        <Card title="Delivery history">
          <div className="attendee-detail-readonly">
            <BarsRow labelWidth={150} valueWidth={64} />
            <BarsRow labelWidth={120} valueWidth={64} />
            <BarsRow labelWidth={170} valueWidth={64} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * The Activity tab: the timeline's rows (a dot, a headline with a detail line under it, the time and who did it, on the page's own
 * row classes, with the heights of its lines of text) and the pager under them. Every attendee has at least the row that says they were
 * added, so there are always rows to draw; how many more is what the read says.
 */
function ActivityBody() {
  return (
    <Card padded className="attendee-detail-skeleton" aria-hidden="true">
      <ul className="at-timeline">
        {ACTIVITY_ROWS.map(({ id, headline, detail }) => (
          <li className="at-tl-item" key={id}>
            <div className="at-tl-dot">
              <Skeleton variant="circle" width={28} height={28} />
            </div>
            <div className="at-tl-body">
              <Line width={headline} bar={14} line={21} />
              <Line width={detail} bar={12} line={22} />
            </div>
            <div className="at-tl-meta">
              <Line width={146} bar={12} line={18} />
              <Line width={112} bar={12} line={18} />
            </div>
          </li>
        ))}
      </ul>
      <div className="audit-log-footer">
        <div className="audit-log-footer__summary">
          <Skeleton variant="rect" width={112} height={14} />
          <Skeleton variant="rect" width={142} height={28} />
        </div>
        <div className="audit-log-footer__pager">
          <Skeleton variant="rect" width={80} height={28} />
          <Skeleton variant="rect" width={56} height={14} />
          <Skeleton variant="rect" width={48} height={28} />
        </div>
      </div>
    </Card>
  );
}

/**
 * The Notes tab: the hint that is the same for every attendee (for real), the composer (the field and the Add button as bars, the
 * size of the real ones) and one note, to say what the list is; how many notes there are, if any, is what the read says.
 */
function NotesBody() {
  return (
    <Card padded className="attendee-detail-skeleton" aria-hidden="true">
      <Notice variant="info" className="at-notes-hint">
        {NOTES_HINT}
      </Notice>
      <div className="at-notes-form">
        <Skeleton variant="rect" className="attendee-detail-skeleton__textarea" />
        <div className="at-notes-form__actions">
          <Skeleton variant="rect" width={43} height={28} />
        </div>
      </div>
      <ul className="at-notes-list">
        <li className="at-notes-list__item">
          <div className="at-notes-list__head">
            <div className="at-notes-list__author-group">
              <span className="at-avatar at-avatar--sm">
                <Skeleton variant="circle" width={28} height={28} />
              </span>
              <Line width={120} bar={14} line={21} />
              <Skeleton variant="rect" width={74} height={19} />
            </div>
            <Line width={146} bar={12} line={18} />
          </div>
          <Line width="100%" bar={14} line={21} />
          <Line width="58%" bar={14} line={21} />
        </li>
      </ul>
    </Card>
  );
}

/** The body of the tab that is open: the one the address asks for, since the page opens on it. */
function TabBody({ tab }: Readonly<{ tab: AttendeeSkeletonTab }>) {
  if (tab === "activity") return <ActivityBody />;
  if (tab === "notes") return <NotesBody />;
  return <OverviewBody />;
}

/**
 * The attendee page while its record is on its way, in the shape of the page: its header (the Back button is real, so a
 * slow read can be left; Edit and More actions need the record, so they are bars), the status chips (four, and a fifth, Wallet, when
 * the event offers a wallet platform, which the event the page already has says, so the strip has the rows it will have) and the tabs
 * with their real names, the one the address asks for (`?tab=activity`, `?tab=notes`) marked as the open one, and under them the body
 * of that tab: the cards of Overview with their real titles over rows of bars, the rows of the Activity log and its pager, or the
 * hint, the composer and a note of Notes. It uses the page's own classes, so the stylesheet lays it out at every width exactly as it
 * lays out the page, and the status region says what is loading (and, after 8 seconds, that it is taking longer than usual) for
 * assistive tech and in view.
 *
 * Drawn on the page itself, the bars of a skeleton are as light as the background: the cards are what make them show.
 */
export function AttendeeDetailSkeleton({
  slow,
  isDesktop,
  onBack,
  walletPlatforms,
  tab,
}: Readonly<{
  slow: boolean;
  isDesktop: boolean;
  onBack: () => void;
  walletPlatforms: EnabledWalletPlatforms;
  tab: AttendeeSkeletonTab;
}>) {
  const chips = hasWalletStatusChip(walletPlatforms) ? [...STATUS_CHIPS, WALLET_CHIP] : STATUS_CHIPS;
  return (
    <>
      <PageHeader
        title="Attendee"
        subtitle="Manage this attendee's profile, ticket, and check-in status."
        className="attendee-detail-pageheader"
        actions={
          <>
            {isDesktop && <Skeleton variant="rect" width={74} height={36} />}
            <Skeleton variant="rect" width={isDesktop ? 158 : 142} height={isDesktop ? 36 : 28} />
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          </>
        }
      />
      {/* The status region of the placeholder. It takes no room of its own (the page's rows are a flex column with a gap, so an empty
          item would add one) until the note is in it. */}
      <output className={slow ? "attendee-detail-skeleton__status attendee-detail-skeleton__status--note" : "attendee-detail-skeleton__status"}>
        <span className="sr-only">Loading attendee</span>
        {slow ? <span className="at-hint attendee-detail-slow-note">{SLOW_NOTICE_TEXT}</span> : null}
      </output>
      <div className="attendee-status-strip" aria-hidden="true">
        {chips.map(({ icon, label, badgeWidth }) => (
          <div className="attendee-status-chip" key={label}>
            <span className="attendee-status-chip__icon attendee-status-chip__icon--neutral">
              <i className={`ti ti-${icon}`} aria-hidden="true" />
            </span>
            <div className="attendee-status-chip__body">
              <strong>{label}</strong>
              <Skeleton variant="rect" width={badgeWidth} height={19} />
            </div>
          </div>
        ))}
      </div>
      <div className="at-tabs attendee-detail-skeleton__tabs" aria-hidden="true">
        {TABS.map(({ id, label }) => (
          <span className={id === tab ? "at-tab at-tab--active" : "at-tab"} key={id}>
            {label}
          </span>
        ))}
      </div>
      <TabBody tab={tab} />
    </>
  );
}
