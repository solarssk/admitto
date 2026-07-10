import { Card, StatusBadge } from "@admitto/ui";
import type { CheckInScanResponse, CheckInStatus } from "../api/types.js";

/** Shared with CheckInPage: the desktop camera reports a no-match scan via
 * the same toast as manual lookup's no-match, using this exact copy, rather
 * than rendering this card on top of the camera view (#456 review). */
export function feedbackCopy(status: CheckInStatus): string {
  switch (status) {
    case "INVALID":
      return "This code is not valid for this event. Check the QR or use manual lookup.";
    case "REVOKED":
      return "This ticket has been revoked or cancelled.";
    case "ALREADY_CHECKED_IN":
      return "This guest is already checked in.";
    case "VALID":
      return "Check-in recorded.";
    case "PREVIEW":
      return "Attendee found — confirm check-in below.";
    default:
      return "";
  }
}

type Props = {
  result: CheckInScanResponse;
  /** Hide when a full attendee card is shown for the same result. */
  hidden?: boolean;
};

/** Compact scan outcome when there is no attendee card (invalid/revoked) or as a top-level status strip. */
export function ScanFeedback({ result, hidden }: Props) {
  if (hidden) return null;

  const message = feedbackCopy(result.status);
  if (!message) return null;

  return (
    <Card
      className={`checkin-feedback checkin-feedback--${result.status.toLowerCase()}`}
      role="status"
      aria-live="polite"
    >
      <div className="checkin-feedback__header">
        <StatusBadge status={result.status} />
      </div>
      <p className="checkin-feedback__message">{message}</p>
    </Card>
  );
}
