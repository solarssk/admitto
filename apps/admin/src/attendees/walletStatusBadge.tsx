import { Badge } from "@admitto/ui";
import type { WalletPassStatus } from "@admitto/db/status";

export const WALLET_STATUS_LABELS: Record<WalletPassStatus, string> = {
  pending: "Pending",
  // "active" only means PassCreator created/updated the pass server-side, not that the attendee
  // actually added it to an Apple/Google Wallet - they may have opened the "Add to Wallet" link
  // and backed out of the OS install sheet (PO report, 2026-08-17). The generic label stays
  // honest about that ("Sent"); WalletStatusBadge below upgrades it to "Added" once PassCreator's
  // own registration counts confirm a real device install.
  active: "Sent",
  voided: "Voided",
  failed: "Failed",
  expired: "Expired",
};

/** Activity-log transitions (wallet_pass_voided/restored metadata.previous_status) only ever
 * record the bare WalletPassStatus enum value, never registration counts, so they can't tell
 * whether the pass was actually installed at that point in time. Reusing WALLET_STATUS_LABELS'
 * install-aware "Sent" wording here would misreport a pass that genuinely was confirmed installed
 * when it got voided/restored - this neutral "Active" is for that historical/lifecycle context
 * only, distinct from the live badge's "Sent"/"Added" split above. */
export const WALLET_LIFECYCLE_STATUS_LABELS: Record<WalletPassStatus, string> = {
  ...WALLET_STATUS_LABELS,
  active: "Active",
};

export const WALLET_STATUS_VARIANTS: Record<WalletPassStatus, "neutral" | "ok" | "error" | "warn"> = {
  pending: "neutral",
  active: "ok",
  voided: "error",
  failed: "error",
  expired: "warn",
};

/** True once PassCreator itself has confirmed at least one device actually registered this pass
 * (apple/google_active_registrations > 0) - the only signal that distinguishes a genuinely
 * installed pass from one that was merely created server-side. Null counts (worker hasn't synced
 * yet) or a confirmed zero both read as "not installed" - we only claim "Added" on positive
 * evidence from the API, never by default. */
export function isWalletPassInstalled(pass: {
  apple_active_registrations: number | null;
  google_active_registrations: number | null;
}): boolean {
  return (pass.apple_active_registrations ?? 0) > 0 || (pass.google_active_registrations ?? 0) > 0;
}

/** `status: null` means the attendee has never added this ticket to a wallet - distinct from
 * "pending" (there's no such state today: a WalletPass row is only ever created once the first
 * add-to-wallet attempt has already succeeded or failed). `installed` overrides the generic
 * "Sent" label to "Added" for a confirmed-registered active pass (see isWalletPassInstalled). */
export function WalletStatusBadge({
  status,
  installed = false,
}: Readonly<{ status: WalletPassStatus | null; installed?: boolean }>) {
  if (!status) return <Badge variant="neutral">Not added</Badge>;
  if (status === "active" && installed) return <Badge variant="ok">Added</Badge>;
  return <Badge variant={WALLET_STATUS_VARIANTS[status]}>{WALLET_STATUS_LABELS[status]}</Badge>;
}
