import { Button } from "@admitto/ui";
import type { AttendeeCardDto, CheckInScanResponse, CheckInStatus, TicketTypeDto } from "../api/types.js";
import { formatEventDateTime } from "../utils/event-dates.js";
import { TicketTypeBadge } from "../attendees/ticketTypeBadge.js";

function formatAlreadyCheckedInSubtitle(admittedAt: string | undefined, eventTimezone: string): string {
  if (!admittedAt) return "Already checked in";
  const when = new Date(admittedAt);
  if (Number.isNaN(when.getTime())) return "Already checked in";
  return `Entered ${formatEventDateTime(admittedAt, eventTimezone)}`;
}

function statusMeta(status: CheckInStatus): {
  icon: string;
  title: string;
  subtitle: string;
  tone: "ok" | "warn" | "error" | "info";
} {
  switch (status) {
    case "VALID":
      return {
        icon: "ti-circle-check",
        title: "Valid",
        subtitle: "Check-in recorded",
        tone: "ok",
      };
    case "ALREADY_CHECKED_IN":
      return {
        icon: "ti-clock-exclamation",
        title: "Already checked in",
        subtitle: "Already checked in",
        tone: "warn",
      };
    case "INVALID":
      return {
        icon: "ti-circle-x",
        title: "Invalid ticket",
        subtitle: "Code not valid for this event",
        tone: "error",
      };
    case "REVOKED":
      return {
        icon: "ti-ban",
        title: "Revoked",
        subtitle: "Ticket cancelled or revoked",
        tone: "error",
      };
    case "PREVIEW":
      return {
        icon: "ti-circle-check",
        title: "Valid",
        subtitle: "Admit attendee",
        tone: "ok",
      };
    default:
      return {
        icon: "ti-help-circle",
        title: "Unknown",
        subtitle: "Unrecognized status",
        tone: "warn",
      };
  }
}

type CheckInCameraResultPanelProps = {
  scanResult: CheckInScanResponse;
  card: AttendeeCardDto | null;
  ticketTypes?: TicketTypeDto[];
  pending: boolean;
  canAct: boolean;
  eventTimezone: string;
  onConfirm?: () => void;
  onReset: () => void;
  /** When set, Cancel exits camera mode; otherwise Cancel clears the result only. */
  onCancel?: () => void;
  /** Small "Issue items" entry point on the Already-checked-in card — mobile
   * overlay only (desktop's CkInlineCamera never passes it): opens the item
   * flow for an attendee admitted earlier whose items weren't handed out. */
  onIssueItems?: () => void;
  className?: string;
};

export function CheckInCameraResultPanel({
  scanResult,
  card,
  ticketTypes = [],
  pending,
  canAct,
  eventTimezone,
  onConfirm,
  onReset,
  onCancel,
  onIssueItems,
  className,
}: CheckInCameraResultPanelProps) {
  const meta = statusMeta(scanResult.status);
  const subtitle =
    scanResult.status === "ALREADY_CHECKED_IN"
      ? formatAlreadyCheckedInSubtitle(scanResult.admittedAt, eventTimezone)
      : meta.subtitle;

  const isPreview = scanResult.status === "PREVIEW";

  return (
    <div className={`ck-overlay__result ck-overlay__result--${meta.tone}${className ? ` ${className}` : ""}`}>
      <i className={`ti ${meta.icon} ck-overlay__result-icon`} aria-hidden="true" />
      <h2 className="ck-overlay__result-title">{meta.title}</h2>
      <p className="ck-overlay__result-sub">{subtitle}</p>
      {card && (
        <div className="ck-overlay__result-card">
          <strong>{card.name}</strong>
          {/* Same TicketTypeBadge AttendeeCard.tsx uses on desktop, not a
              plain <span> — ticket-type coloring (e.g. VIP) is sourced from
              one place, not redefined per surface (PO review). */}
          {card.ticket_type && (
            <TicketTypeBadge ticketType={card.ticket_type} catalog={ticketTypes} />
          )}
        </div>
      )}
      <div className="ck-overlay__result-actions">
        {isPreview && onConfirm && (
          <Button
            type="button"
            variant="primary"
            size="lg"
            disabled={!canAct || pending}
            onClick={onConfirm}
          >
            Confirm check-in
          </Button>
        )}
        {!isPreview && (
          <Button type="button" variant="secondary" onClick={onReset}>
            Scan next
          </Button>
        )}
        <div className="ck-overlay__result-secondary">
          {onIssueItems && (
            <button type="button" className="ck-overlay__result-chip" onClick={onIssueItems}>
              <i className="ti ti-package" aria-hidden="true" /> Issue items
            </button>
          )}
          <button type="button" className="link-btn ck-overlay__result-chip" onClick={onCancel ?? onReset}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
