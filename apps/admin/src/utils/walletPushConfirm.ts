/** Shared copy for the "this will push to N installed wallet passes" confirm dialog shown on
 * Event Settings' General/Wallet tab (EventSettingsPage.tsx) and Location tab
 * (LocationSettingsPanel.tsx) before a save that touches a WALLET_RELEVANT_EVENT_FIELDS or
 * WALLET_RELEVANT_LOCATION_FIELDS field. `pluralSuffix` only ever appends a bare "s", which is
 * wrong for "pass" -> "passes" and for "attendee's" -> "attendees'" (an apostrophe-s swap, not a
 * suffix) - both irregular for that helper, so this spells out the two forms explicitly instead. */
export function describeWalletPushConfirm(installedCount: number): string {
  const attendeePossessive = installedCount === 1 ? "attendee's" : "attendees'";
  const pass = installedCount === 1 ? "pass" : "passes";
  return `This will push the update to ${installedCount} ${attendeePossessive} installed wallet ${pass}.`;
}

/** Confirm-dialog copy for clearing the wallet API key on an event with already-issued passes
 * (EventSettingsPage.tsx's own handleSave). Clearing doesn't corrupt anything the way changing the
 * Template ID does (registration-sync.ts's own resolveWalletProvider-returns-null path degrades
 * cleanly, never writing fake data) - but it does silently stop all sync/void/restore/push
 * activity for every already-issued pass with zero indication anything changed, which is worth a
 * deliberate confirmation the same way other wallet-relevant saves already get one (CodeRabbit
 * review). Gated on `issued_wallet_pass_count`, not `installed_wallet_pass_count` - an
 * issued-but-not-yet-installed pass stops being manageable too. */
export function describeWalletKeyClearConfirm(issuedCount: number): string {
  const pass = issuedCount === 1 ? "pass" : "passes";
  return `This event has ${issuedCount} issued wallet ${pass}. Clearing the API key stops syncing, voiding, restoring, and pushing updates to ${issuedCount === 1 ? "it" : "them"} until a working key is set again.`;
}
