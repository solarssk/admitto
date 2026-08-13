/** Apple/Google registration counts as PassCreator itself reports them (refreshed periodically by
 * the wallet_sync worker job, apps/cli - never on a request path). `null` counts mean the worker
 * hasn't checked yet, not "confirmed zero" - distinct from a confirmed 0. Shared by the attendee
 * detail page and the Attendees list's Wallet column so both surfaces describe the exact same
 * state the same way. */
/** "Status unknown", not "Not checked yet" - "checked" collides with check-in terminology
 * elsewhere in Admitto, and reads as if nothing has happened yet when the attendee may well
 * already have the pass in their wallet - we just haven't confirmed it with PassCreator (PO
 * review, 2026-08-13). */
export function walletRegistrationLabel(active: number | null, inactive: number | null): string {
  if (active === null && inactive === null) return "Status unknown";
  if ((active ?? 0) > 0) return (active ?? 0) > 1 ? `Registered (${active} devices)` : "Registered";
  if ((inactive ?? 0) > 0) return "Unregistered";
  return "Not added";
}
