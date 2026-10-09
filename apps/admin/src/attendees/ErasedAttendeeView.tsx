import type { ReactNode } from "react";
import { Button, Card, Notice, PageHeader } from "@admitto/ui";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import type { AttendeeDetailDto, EventDto, TicketTypeDto } from "../api/types.js";
import { MoreActionsMenuItem } from "../components/MoreActionsMenuItem.js";
import { useDropdownMenu } from "../components/useDropdownMenu.js";
import { useIsDesktop } from "../hooks/useIsDesktop.js";
import { formatEventDate } from "../utils/event-dates.js";
import { ERASED_ATTENDEE_LABEL } from "./erasedAttendee.js";
import { ErasedBadge } from "./ErasedBadge.js";
import { MailStatusBadge } from "./mailStatusBadge.js";
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
  const removedAt = detail.wallet_pass?.provider_removed_at;
  if (removedAt) {
    return (
      <ErasedRow label="Pass at the wallet provider">{`Deleted on ${formatEventDate(removedAt, timezone)}`}</ErasedRow>
    );
  }
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
  return <ErasedRow label="Pass at the wallet provider">None</ErasedRow>;
}

/** The More actions menu of an erased attendee: nothing here sends, issues or edits. Erase is
 * there but off, with the date it happened; deleting the entry stays available. */
function ErasedActionsMenu({ erasedOn, onDelete }: Readonly<{ erasedOn: string; onDelete: () => void }>) {
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
            label="Delete attendee"
            hint="Permanently remove this entry"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The page of an attendee whose personal data has been erased: read-only. The entry stays so that
 * counts and capacity do not move, and it says so. Every field that held personal data reads
 * "Erased"; what the entry keeps (ticket type, delivery result, check-in time to the hour) is shown
 * as it is.
 */
export function ErasedAttendeeView({
  detail,
  erasedAt,
  event,
  ticketTypes,
  walletPlatforms,
  statusStrip,
  error,
  onBack,
  onDelete,
  onWalletTryAgain,
}: Readonly<{
  detail: AttendeeDetailDto;
  /** When the personal data was erased (`detail.erased_at`, which the page has checked is set). */
  erasedAt: string;
  event: Pick<EventDto, "timezone">;
  ticketTypes: TicketTypeDto[];
  walletPlatforms: EnabledWalletPlatforms;
  /** The row of status chips, built by the page that owns them. */
  statusStrip: ReactNode;
  /** A read of the page that failed (after an erasure, or a retry), shown above the page. */
  error: string | null;
  onBack: () => void;
  onDelete: () => void;
  onWalletTryAgain: () => void;
}>) {
  const isDesktop = useIsDesktop();
  const erasedOn = formatEventDate(erasedAt, event.timezone);
  // The Wallet card is there when the event offers wallet passes, or this entry still has one.
  const showWallet =
    detail.wallet_pass !== null || walletPlatforms.apple || walletPlatforms.google || walletPlatforms.samsung;
  return (
    <>
      <PageHeader
        title={
          <>
            {ERASED_ATTENDEE_LABEL}
            <ErasedBadge />
          </>
        }
        subtitle="This entry is kept for your counts. It has no personal details."
        className="attendee-detail-pageheader"
        actions={
          <>
            {isDesktop && (
              <Button type="button" variant="secondary" icon={<i className="ti ti-pencil" aria-hidden="true" />} disabled>
                Edit
              </Button>
            )}
            <ErasedActionsMenu erasedOn={erasedOn} onDelete={onDelete} />
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          </>
        }
      />
      {error && (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      )}
      <Notice variant="highlight" icon="eraser">
        Personal data erased on {erasedOn}. This entry stays in your counts, with no personal details.
      </Notice>
      {statusStrip}
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
                <ErasedRow label="Ticket link and QR code">No longer work</ErasedRow>
              </div>
            </Card>
          )}
          <Card title="Activity log">
            <p className="erased-value">The change history for this person was erased.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
