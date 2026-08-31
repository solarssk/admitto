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
