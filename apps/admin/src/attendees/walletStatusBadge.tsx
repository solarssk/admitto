import { Badge } from "@admitto/ui";
import type { WalletPassStatus } from "@admitto/db/status";

export const WALLET_STATUS_LABELS: Record<WalletPassStatus, string> = {
  pending: "Pending",
  active: "Added",
  voided: "Voided",
  failed: "Failed",
  expired: "Expired",
};

export const WALLET_STATUS_VARIANTS: Record<WalletPassStatus, "neutral" | "ok" | "error" | "warn"> = {
  pending: "neutral",
  active: "ok",
  voided: "error",
  failed: "error",
  expired: "warn",
};

/** `status: null` means the attendee has never added this ticket to a wallet - distinct from
 * "pending" (there's no such state today: a WalletPass row is only ever created once the first
 * add-to-wallet attempt has already succeeded or failed). */
export function WalletStatusBadge({ status }: Readonly<{ status: WalletPassStatus | null }>) {
  if (!status) return <Badge variant="neutral">Not added</Badge>;
  return <Badge variant={WALLET_STATUS_VARIANTS[status]}>{WALLET_STATUS_LABELS[status]}</Badge>;
}
