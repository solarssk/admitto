import { Button } from "@admitto/ui";
import type { AttendeeCardDto, CheckInScanResponse, CheckInStatus } from "../api/types.js";

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
        subtitle: "Entered earlier today",
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
  pending: boolean;
  canAct: boolean;
  onConfirm?: () => void;
  onReset: () => void;
  /** When set, Cancel exits camera mode; otherwise Cancel clears the result only. */
  onCancel?: () => void;
  className?: string;
};

export function CheckInCameraResultPanel({
  scanResult,
  card,
  pending,
  canAct,
  onConfirm,
  onReset,
  onCancel,
  className,
}: CheckInCameraResultPanelProps) {
  const meta = statusMeta(scanResult.status);
  const isPreview = scanResult.status === "PREVIEW";

  return (
    <div className={`ck-overlay__result ck-overlay__result--${meta.tone}${className ? ` ${className}` : ""}`}>
      <i className={`ti ${meta.icon} ck-overlay__result-icon`} aria-hidden="true" />
      <h2 className="ck-overlay__result-title">{meta.title}</h2>
      <p className="ck-overlay__result-sub">{meta.subtitle}</p>
      {card && (
        <div className="ck-overlay__result-card">
          <strong>{card.name}</strong>
          {card.ticket_type && <span>{card.ticket_type}</span>}
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
        <button type="button" className="link-btn" onClick={onCancel ?? onReset}>
          Cancel
        </button>
      </div>
    </div>
  );
}
