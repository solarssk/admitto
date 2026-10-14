import type { ReactNode } from "react";
import { Button, Card, EmptyState, Notice, PageHeader } from "@admitto/ui";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import type { AttendeeDetailDto, AttendeeErasureDto, EventDto, TicketTypeDto } from "../api/types.js";
import { isEventArchived } from "../components/ArchivedGuard.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { RefreshWarning } from "../components/RefreshWarning.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { formatEventDate } from "../utils/event-dates.js";
import { formatActivityTimestamp } from "./attendeeTimeline.js";
import { ERASED_ATTENDEE_LABEL, erasedByName, erasedNoticeText, erasureViaLine } from "./erasedAttendee.js";
import { MailStatusBadge } from "./mailStatusBadge.js";
import { REMOVE_ARCHIVED_TOOLTIP } from "./removeAttendee.js";
import { TicketTypeBadge } from "./ticketTypeBadge.js";
import "./attendees.css";

/** The Erase item of an erased attendee's menu is off, so its click never happens. */
const noop = () => undefined;

/** One line of a card that holds nothing any more. */
function ErasedRow({ label, children }: Readonly<{ label: string; children?: ReactNode }>) {
  return (
    <div className="attendee-detail-row">
      <span>{label}</span>
      <span className={children === undefined ? "erased-value" : undefined}>{children ?? "Erased"}</span>
    </div>
  );
}

/** What the Wallet card says about the pass at the provider. */
function ProviderPassRow({
  detail,
  timezone,
  onTryAgain,
}: Readonly<{ detail: AttendeeDetailDto; timezone: string; onTryAgain: () => void }>) {
  // Still to be deleted comes first: a pass left in another account keeps the row open although the recorded pass was removed.
  if (detail.wallet_pass_delete_pending) {
    return (
      <div className="attendee-detail-row">
        <span>Pass at the wallet provider</span>
        <span className="erased-wallet-pending">
          Not deleted yet
          <Button type="button" variant="secondary" size="sm" onClick={onTryAgain}>
            Try again
          </Button>
        </span>
      </div>
    );
  }
  const removedAt = detail.wallet_pass?.provider_removed_at;
  if (removedAt) {
    return (
      <ErasedRow label="Pass at the wallet provider">{`Deleted on ${formatEventDate(removedAt, timezone)}`}</ErasedRow>
    );
  }
  return <ErasedRow label="Pass at the wallet provider">None</ErasedRow>;
}

/** The More actions menu of an erased attendee: nothing here sends, issues or edits. Erase is
 * there but off, with the date it happened; removing the entry from the event stays available, except on an
 * archived event, whose numbers are final. */
function ErasedActionsMenu({
  erasedOn,
  archived,
  onRemove,
}: Readonly<{ erasedOn: string; archived: boolean; onRemove: () => void }>) {
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
  });
  return (
    <div className="more-actions-menu" ref={rootRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        icon={<i className="ti ti-dots-vertical" aria-hidden="true" />}
        hasMenu
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        More actions
      </Button>
      {open && (
        <div className="more-actions-menu__panel at-scroll" role="menu" ref={panelRef} style={panelStyle}>
          <MoreActionsMenuItem
            icon="eraser"
            variant="danger"
            label="Erase personal data"
            hint={`Personal data was erased on ${erasedOn}.`}
            disabled
            onClick={noop}
          />
          <hr className="more-actions-menu__divider" />
          <MoreActionsMenuItem
            icon="trash"
            variant="danger"
            label="Remove from event"
            hint="For a mistake, duplicate or test person. Changes Reports."
            disabled={archived}
            tooltip={archived ? REMOVE_ARCHIVED_TOOLTIP : undefined}
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The tabs of the attendee page, which an erased attendee keeps (the page owns the strip and the `?tab=` address). */
export type ErasedAttendeeTab = "overview" | "activity" | "notes";

/** Overview: what the entry keeps is shown as it is, and every field that held personal data reads "Erased". */
function ErasedOverviewTab({
  detail,
  event,
  ticketTypes,
  walletPlatforms,
  onWalletTryAgain,
}: Readonly<{
  detail: AttendeeDetailDto;
  event: Pick<EventDto, "timezone">;
  ticketTypes: TicketTypeDto[];
  walletPlatforms: EnabledWalletPlatforms;
  onWalletTryAgain: () => void;
}>) {
  // The Wallet card is there when the event offers wallet passes, or this entry still has one.
  const showWallet =
    detail.wallet_pass !== null || walletPlatforms.apple || walletPlatforms.google || walletPlatforms.samsung;
  return (
    <div className="attendee-detail-grid">
      <div className="attendee-detail-main">
        <Card title="Profile" className="attendee-detail-profile">
          <div className="attendee-detail-readonly">
            <ErasedRow label="Name" />
            <ErasedRow label="Email" />
            <ErasedRow label="Company" />
            <div className="attendee-detail-row">
              <span>Ticket type</span>
              <TicketTypeBadge ticketType={detail.ticket_type} catalog={ticketTypes} />
            </div>
            <ErasedRow label="Custom fields" />
            <ErasedRow label="Notes" />
          </div>
        </Card>
      </div>
      <div className="attendee-detail-side">
        <Card title="Delivery history">
          <div className="attendee-detail-readonly">
            <div className="attendee-detail-row">
              <span>Ticket email</span>
              <MailStatusBadge status={detail.deliveries[0]?.status ?? null} />
            </div>
            <ErasedRow label="Message copies" />
          </div>
        </Card>
        {showWallet && (
          <Card title="Wallet">
            <div className="attendee-detail-readonly">
              <ProviderPassRow detail={detail} timezone={event.timezone} onTryAgain={onWalletTryAgain} />
              <ErasedRow label="Ticket link and QR code">No longer works</ErasedRow>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * Activity log: the person's history went with their personal data, but the erasure itself stays on record, as
 * one entry in the shape of every other: when, by whom, through what, and from where for a viewer who is told.
 * An erasure the audit log has no entry of leaves the tab saying the history is gone.
 */
function ErasedActivityTab({
  erasure,
  erasedAt,
  timezone,
}: Readonly<{ erasure: AttendeeErasureDto | null; erasedAt: string; timezone: string }>) {
  if (erasure === null) {
    return (
      <Card padded>
        <EmptyState
          icon={<i className="ti ti-history" aria-hidden="true" />}
          title="History erased"
          description="The change history for this person was erased."
        />
      </Card>
    );
  }
  const name = erasedByName(erasure);
  return (
    <Card padded>
      <ul className="at-timeline">
        <li className="at-tl-item">
          <div className="at-tl-dot at-tl-dot--neutral">
            <i className="ti ti-eraser" aria-hidden="true" />
          </div>
          <div className="at-tl-body">
            <b>Personal data erased</b>
            <span>{erasureViaLine(erasure)}</span>
          </div>
          <div className="at-tl-meta">
            <time className="at-tl-time" dateTime={erasedAt}>
              {formatActivityTimestamp(erasedAt, erasure.timezone, timezone)}
            </time>
            {name !== null && (
              <span className="at-tl-actor">
                <i className="ti ti-user" aria-hidden="true" />
                {name}
              </span>
            )}
          </div>
        </li>
      </ul>
      <p className="erased-history-note">The rest of the change history was erased with the personal data.</p>
    </Card>
  );
}

/** Notes: they were erased too, and none can be added to an erased entry, so there is no composer. */
function ErasedNotesTab() {
  return (
    <Card padded>
      <EmptyState
        icon={<i className="ti ti-notes" aria-hidden="true" />}
        title="Notes erased"
        description="Notes were erased with the personal data. None can be added to an erased entry."
      />
    </Card>
  );
}

/**
 * The page of an attendee whose personal data has been erased: read-only. The entry stays so that
 * the Reports totals do not move, and it says so. It keeps the page of every other attendee: the
 * same header, status chips and tabs (Overview, Activity log, Notes), each of which says what
 * became of its contents. Every field that held personal data reads "Erased"; what the entry keeps
 * (ticket type, delivery result, check-in time to the hour) is shown as it is.
 */
export function ErasedAttendeeView({
  detail,
  erasedAt,
  event,
  ticketTypes,
  walletPlatforms,
  statusStrip,
  tabStrip,
  tab,
  error,
  onRetry,
  onBack,
  onRemove,
  onWalletTryAgain,
}: Readonly<{
  detail: AttendeeDetailDto;
  /** When the personal data was erased (`detail.erased_at`, which the page has checked is set). */
  erasedAt: string;
  event: Pick<EventDto, "timezone" | "archived_at">;
  ticketTypes: TicketTypeDto[];
  walletPlatforms: EnabledWalletPlatforms;
  /** The row of status chips, built by the page that owns them. */
  statusStrip: ReactNode;
  /** The strip of tabs, built by the page that owns it and its `?tab=` address, the same one every attendee has. */
  tabStrip: ReactNode;
  /** The tab the strip has open. */
  tab: ErasedAttendeeTab;
  /** A read of the page that failed (after an erasure, or a retry), shown above the page with a Retry. */
  error: string | null;
  /** Reads the page again: the Retry of `error`. */
  onRetry: () => Promise<void>;
  onBack: () => void;
  onRemove: () => void;
  onWalletTryAgain: () => void;
}>) {
  const isDesktop = useIsDesktop();
  const erasedOn = formatEventDate(erasedAt, event.timezone);
  const erasure = detail.erasure ?? null;
  return (
    <>
      <PageHeader
        title={ERASED_ATTENDEE_LABEL}
        subtitle="This entry is kept for your counts. It has no personal details."
        className="attendee-detail-pageheader"
        actions={
          <>
            {isDesktop && (
              <Button type="button" variant="secondary" icon={<i className="ti ti-pencil" aria-hidden="true" />} disabled>
                Edit
              </Button>
            )}
            <ErasedActionsMenu erasedOn={erasedOn} archived={isEventArchived(event)} onRemove={onRemove} />
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          </>
        }
      />
      {error && <RefreshWarning message={error} onRetry={onRetry} landmark=".attendee-detail-page" />}
      <Notice variant="highlight" icon="eraser" className="erased-notice">
        {erasedNoticeText(erasedOn, erasure)}
      </Notice>
      {statusStrip}
      {tabStrip}
      {tab === "overview" && (
        <ErasedOverviewTab
          detail={detail}
          event={event}
          ticketTypes={ticketTypes}
          walletPlatforms={walletPlatforms}
          onWalletTryAgain={onWalletTryAgain}
        />
      )}
      {tab === "activity" && <ErasedActivityTab erasure={erasure} erasedAt={erasedAt} timezone={event.timezone} />}
      {tab === "notes" && <ErasedNotesTab />}
    </>
  );
}
