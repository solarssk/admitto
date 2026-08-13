import { Tooltip } from "@admitto/ui";
import type { AttendeeRowDto } from "../api/types.js";
import { walletRegistrationLabel } from "./walletRegistrationLabel.js";

function PlatformIcon({
  iconClass,
  active,
  label,
}: Readonly<{ iconClass: string; active: boolean; label: string }>) {
  return (
    <Tooltip content={label}>
      <i
        className={`ti ${iconClass} attendees-table-v2__wallet-icon${
          active ? " attendees-table-v2__wallet-icon--active" : ""
        }`}
        aria-label={label}
      />
    </Tooltip>
  );
}

/** Which wallet(s) (Apple/Google) an attendee has actually registered their pass to, shown
 * compactly in the Attendees list - one icon per platform, highlighted when
 * apple/google_active_registrations is nonzero. A dash when no WalletPass row exists yet (wallet
 * not configured for the event, or the attendee hasn't added it). Shares its label vocabulary
 * with the attendee detail page's own wallet section (walletRegistrationLabel) so both surfaces
 * describe the exact same state the same way. */
export function WalletColumnCell({
  status,
}: Readonly<{ status: AttendeeRowDto["wallet_status"] }>) {
  if (!status) return <span className="attendee-readonly">-</span>;
  return (
    <span className="attendees-table-v2__wallet">
      <PlatformIcon
        iconClass="ti-brand-apple"
        active={(status.apple_active_registrations ?? 0) > 0}
        label={`Apple Wallet: ${walletRegistrationLabel(status.apple_active_registrations, status.apple_inactive_registrations)}`}
      />
      <PlatformIcon
        iconClass="ti-brand-google"
        active={(status.google_active_registrations ?? 0) > 0}
        label={`Google Wallet: ${walletRegistrationLabel(status.google_active_registrations, status.google_inactive_registrations)}`}
      />
    </span>
  );
}
