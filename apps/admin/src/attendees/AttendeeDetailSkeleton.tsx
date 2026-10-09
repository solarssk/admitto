import type { EnabledWalletPlatforms } from "@admitto/shared";
import { Button, Card, PageHeader, Skeleton } from "@admitto/ui";
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

/** A row of a card whose labels depend on the read (the custom fields): a bar for the label and one for the value. */
function BarsRow({ labelWidth, valueWidth }: Readonly<{ labelWidth: number; valueWidth: number }>) {
  return (
    <div className="attendee-detail-row">
      <Skeleton variant="rect" width={labelWidth} height={14} />
      <Skeleton variant="rect" width={valueWidth} height={14} />
    </div>
  );
}

/**
 * The attendee page while its record is on its way, in the shape of the page: its header (the Back button is real, so a
 * slow read can be left; Edit and More actions need the record, so they are bars), the status chips (four, and a fifth, Wallet, when
 * the event offers a wallet platform, which the event the page already has says, so the strip has the rows it will have) and the tabs
 * with their real names, and the cards of the Overview tab with their real titles over rows of bars. It uses the page's
 * own classes, so the stylesheet lays it out at every width exactly as it lays out the page, and the status region says what
 * is loading (and, after 8 seconds, that it is taking longer than usual) for assistive tech and in view.
 *
 * Drawn on the page itself, the bars of a skeleton are as light as the background: the cards are what make them show.
 */
export function AttendeeDetailSkeleton({
  slow,
  isDesktop,
  onBack,
  walletPlatforms,
}: Readonly<{ slow: boolean; isDesktop: boolean; onBack: () => void; walletPlatforms: EnabledWalletPlatforms }>) {
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
        <span className="at-tab at-tab--active">Overview</span>
        <span className="at-tab">Activity log</span>
        <span className="at-tab">Notes</span>
      </div>
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
    </>
  );
}
