import { Tooltip } from "@admitto/ui";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import type { AttendeeRowDto } from "../api/types.js";
import { SamsungGlyphIcon } from "../components/SamsungWalletIcon.js";
import "./attendees.css";
import { walletRegistrationLabel } from "./walletRegistrationLabel.js";

function PlatformIcon({
  iconClass,
  active,
  label,
}: Readonly<{ iconClass: string; active: boolean; label: string }>) {
  return (
    <Tooltip content={label}>
      {/* Tabler icon font glyph (CSS content, no bitmap/vector to swap for a real <img>) - the
          Sonar-preferred native tag doesn't exist for this case. role="img" + aria-label is the
          standard accessible-icon-font pattern; without it screen readers announce nothing here,
          since the wrapping Tooltip only shows a hover/focus bubble and isn't aria-describedby
          wired to this trigger. */}
      <i // NOSONAR — no native tag conveys "img" semantics for a font-glyph icon
        role="img"
        className={`ti ${iconClass} attendees-table-v2__wallet-icon${
          active ? " attendees-table-v2__wallet-icon--active" : ""
        }`}
        aria-label={label}
      />
    </Tooltip>
  );
}

/** Samsung has no Tabler font glyph (see SamsungGlyphIcon's own doc comment), so this passes the
 * exact same active/muted classes PlatformIcon builds for its `<i>` glyphs onto an inline SVG
 * instead - visually identical treatment, just a different element under the hood. Reads real
 * per-attendee status the same way Apple/Google do (WalletPassActionDto.samsung_active_
 * registrations, confirmed live against PassCreator's own search response) - it just stays 0 for
 * every attendee until PassCreator finishes activating Samsung Wallet on the template. */
function SamsungPlatformIcon({ active, label }: Readonly<{ active: boolean; label: string }>) {
  return (
    <Tooltip content={label}>
      <SamsungGlyphIcon
        className={`attendees-table-v2__wallet-icon${active ? " attendees-table-v2__wallet-icon--active" : ""}`}
        aria-label={label}
      />
    </Tooltip>
  );
}

/** Which wallet(s) (Apple, Google, Samsung) an attendee has actually registered their pass to,
 * shown compactly in the Attendees list - one icon per enabled platform, present for every row so
 * the column stays a consistent set of icons to scan down; highlighted when the platform's own
 * *_active_registrations is nonzero, muted otherwise. No WalletPass row at all (wallet not
 * configured for the event, or the attendee hasn't added it) renders the same muted set as a row
 * with a pass nobody registered - "Not added" either way (PO review, 2026-08-14: was a bare dash,
 * less scannable than icons that are just always there). Shares its label vocabulary with the
 * attendee detail page's own wallet section (walletRegistrationLabel) so both surfaces describe
 * the exact same state the same way. `enabledPlatforms` (Event Settings -> Wallet) drops whichever
 * icon(s) the event doesn't offer, and the whole cell renders nothing when neither Apple nor
 * Google is enabled (Samsung alone is never enough - see EnabledWalletPlatforms.any's own doc
 * comment: every attendee's Samsung status reads "Not added" today regardless of real activity,
 * since PassCreator hasn't finished activating Samsung Wallet on any template yet, so showing the
 * column for Samsung alone would be a permanently-empty-looking column) - the caller is expected
 * to skip the column entirely (header and cell) in that case, not render an empty one. */
export function WalletColumnCell({
  status,
  enabledPlatforms,
}: Readonly<{ status: AttendeeRowDto["wallet_status"]; enabledPlatforms: EnabledWalletPlatforms }>) {
  if (!enabledPlatforms.any) return null;
  const appleActive = (status?.apple_active_registrations ?? 0) > 0;
  const googleActive = (status?.google_active_registrations ?? 0) > 0;
  const samsungActive = (status?.samsung_active_registrations ?? 0) > 0;
  // No WalletPass row at all reads as "Not added", not "Status unknown" - the latter is reserved
  // for a pass that does exist but the periodic sync worker hasn't checked yet (both counts null
  // on an existing row), a genuinely different state from never having added one.
  const appleLabel = status
    ? walletRegistrationLabel(status.apple_active_registrations, status.apple_inactive_registrations)
    : "Not added";
  const googleLabel = status
    ? walletRegistrationLabel(status.google_active_registrations, status.google_inactive_registrations)
    : "Not added";
  const samsungLabel = status
    ? walletRegistrationLabel(status.samsung_active_registrations, status.samsung_inactive_registrations)
    : "Not added";
  return (
    <span className="attendees-table-v2__wallet">
      {enabledPlatforms.apple && (
        <PlatformIcon iconClass="ti-brand-apple" active={appleActive} label={`Apple Wallet: ${appleLabel}`} />
      )}
      {enabledPlatforms.google && (
        <PlatformIcon iconClass="ti-brand-google" active={googleActive} label={`Google Wallet: ${googleLabel}`} />
      )}
      {enabledPlatforms.samsung && (
        <SamsungPlatformIcon active={samsungActive} label={`Samsung Wallet: ${samsungLabel}`} />
      )}
    </span>
  );
}
