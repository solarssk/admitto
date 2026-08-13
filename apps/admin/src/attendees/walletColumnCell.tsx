import { Tooltip } from "@admitto/ui";
import type { AttendeeRowDto } from "../api/types.js";
import "./attendees.css";
import { walletRegistrationLabel } from "./walletRegistrationLabel.js";

function PlatformIcon({
  iconClass,
  active,
  label,
}: Readonly<{ iconClass: string; active: boolean; label: string }>) {
  return (
    <Tooltip content={label}>
      <i
        role="img"
        className={`ti ${iconClass} attendees-table-v2__wallet-icon${
          active ? " attendees-table-v2__wallet-icon--active" : ""
        }`}
        aria-label={label}
      />
    </Tooltip>
  );
}

/** Which wallet(s) (Apple/Google) an attendee has actually registered their pass to, shown
 * compactly in the Attendees list - one icon per platform, always present so the column stays a
 * consistent pair of icons to scan down every row; highlighted when
 * apple/google_active_registrations is nonzero, muted otherwise. No WalletPass row at all
 * (wallet not configured for the event, or the attendee hasn't added it) renders the same muted
 * pair as a row with a pass nobody registered - "Not added" either way (PO review, 2026-08-14:
 * was a bare dash, less scannable than icons that are just always there). Shares its label
 * vocabulary with the attendee detail page's own wallet section (walletRegistrationLabel) so
 * both surfaces describe the exact same state the same way. */
export function WalletColumnCell({
  status,
}: Readonly<{ status: AttendeeRowDto["wallet_status"] }>) {
  const appleActive = (status?.apple_active_registrations ?? 0) > 0;
  const googleActive = (status?.google_active_registrations ?? 0) > 0;
  // No WalletPass row at all reads as "Not added", not "Status unknown" - the latter is reserved
  // for a pass that does exist but the periodic sync worker hasn't checked yet (both counts null
  // on an existing row), a genuinely different state from never having added one.
  const appleLabel = status
    ? walletRegistrationLabel(status.apple_active_registrations, status.apple_inactive_registrations)
    : "Not added";
  const googleLabel = status
    ? walletRegistrationLabel(status.google_active_registrations, status.google_inactive_registrations)
    : "Not added";
  return (
    <span className="attendees-table-v2__wallet">
      <PlatformIcon iconClass="ti-brand-apple" active={appleActive} label={`Apple Wallet: ${appleLabel}`} />
      <PlatformIcon iconClass="ti-brand-google" active={googleActive} label={`Google Wallet: ${googleLabel}`} />
    </span>
  );
}
