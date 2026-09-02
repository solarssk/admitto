export type WalletPlatformKey = "apple" | "google" | "samsung";

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

/** Confirm-dialog copy for turning off wallet_enabled (the master switch) on an event with
 * already-issued passes (EventSettingsPage.tsx's own handleSave). Broader than
 * describeWalletKeyClearConfirm above: turning this off also drops every incoming PassCreator
 * webhook for the event outright (a 404, not queued) rather than just pausing them, so a device
 * registration or removal that arrives while it's off is lost, not merely delayed - PO report,
 * 2026-09-02 ("trzeba zabezpieczyć sytuację w której ktoś mógłby przez przypadek... wyłączyć
 * funkcjonalność walletów"). */
export function describeWalletDisableConfirm(issuedCount: number): string {
  const pass = issuedCount === 1 ? "pass" : "passes";
  const it = issuedCount === 1 ? "it" : "them";
  return `This event has ${issuedCount} issued wallet ${pass}. Turning off wallet passes stops syncing, voiding, restoring, and pushing updates to ${it}, and any PassCreator update that arrives while it's off (a device registration, a removal) is dropped rather than queued - it won't be picked up once you turn this back on.`;
}

/** Confirm-dialog copy for turning off one or more per-platform toggles (wallet_apple_enabled /
 * wallet_google_enabled / wallet_samsung_enabled) on a platform that already has installed
 * passes. Narrower than describeWalletDisableConfirm above - a platform toggle doesn't touch
 * sync/void/restore/push (those are gated on wallet_enabled alone, see resolveWalletProvider), it
 * only hides that platform's Add to Wallet button for new attendees. The admin UI doesn't relabel
 * already-installed passes on that platform as "not added" - WalletColumnCell (Attendees list) and
 * AttendeeDetailPage's own registration rows both gate on `enabledPlatforms.<platform> && (...)`,
 * so a disabled platform's icon/row disappears from both surfaces entirely instead (CodeRabbit
 * review - the previous wording claimed the former). `alsoPushes` covers a second, easy-to-miss
 * case: wallet_apple_enabled is itself one of WALLET_RELEVANT_EVENT_FIELDS (its own relevantDate
 * side effect - see that constant's own doc comment), so a save that turns off Apple Wallet on an
 * event with a start time can *also* trigger an event-wide push to every installed pass regardless
 * of platform - resolveWalletConfirmKind computes this the same way the standalone "push" case
 * does and passes it through, so this message doesn't claim "nothing changes on attendees' actual
 * devices" when a push is, in fact, about to happen (CodeRabbit review). */
export function describeWalletPlatformDisableConfirm(
  platforms: readonly WalletPlatformKey[],
  installedCounts: Readonly<Record<WalletPlatformKey, number>>,
  alsoPushes: boolean,
  totalInstalledCount: number,
): string {
  const names: Record<WalletPlatformKey, string> = {
    apple: "Apple Wallet",
    google: "Google Wallet",
    samsung: "Samsung Wallet",
  };
  const labels = platforms.map((platform) => {
    const count = installedCounts[platform];
    return `${names[platform]} (${count} installed ${count === 1 ? "pass" : "passes"})`;
  });
  const joined =
    labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0];
  const plural = platforms.length > 1;
  const totalPass = totalInstalledCount === 1 ? "pass" : "passes";
  const closing = alsoPushes
    ? `This save will also push an update to ${totalInstalledCount} installed wallet ${totalPass} across every platform.`
    : "Nothing changes on attendees' actual devices.";
  return `${joined} already ${plural ? "have" : "has"} attendees who added ${plural ? "them" : "it"} on their device. Turning ${plural ? "these" : "this"} off hides the Add to Wallet button for anyone who hasn't added it yet, and ${plural ? "their" : "its"} status disappears from the Attendees list and attendee detail pages until you turn ${plural ? "them" : "it"} back on. ${closing}`;
}
