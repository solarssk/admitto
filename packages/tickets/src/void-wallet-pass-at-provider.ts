import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

/** `voided` - this call voided the pass at the provider and recorded it locally. `skipped` - not
 * an active, still-managed pass (already voided or expired, or removed at the provider), or one that
 * changed (voided and restored, removed, replaced) since the caller read it. */
export type VoidWalletPassOutcome = "voided" | "skipped";

/**
 * Voids one active wallet pass at the provider and marks the local row `voided`. Shared by the
 * bulk "Void wallet pass" selection route and the event-wide wallet_void_active job, so the two
 * cannot drift apart: same eligibility rule, same conditional write, same action-log entry.
 *
 * `target` is a snapshot: for an event-wide job it was read minutes before this pass's turn, and
 * another operator (or the periodic sync) may have voided, restored, expired or removed the pass
 * since. So the row is read again right before the provider call and the pass is skipped unless it
 * is still active, not removed and, when the snapshot carried `providerCommandedAt`, untouched by
 * any Void or Restore since (that stamp is what a void-then-restore leaves behind). The local write
 * then matches that same state (status, command stamp, pass identity, not removed), so a change
 * landing during the provider call is never overwritten with `voided`.
 */
export async function voidOneWalletPassAtProvider(
  db: PrismaClient,
  eventId: string,
  target: {
    attendeeId: string;
    providerPassId: string;
    status: string;
    providerRemovedAt: Date | null;
    providerCommandedAt?: Date | null;
  },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
  options: { eventWide?: boolean } = {},
): Promise<VoidWalletPassOutcome> {
  if (target.status !== "active" || target.providerRemovedAt) return "skipped";
  const current = await db.walletPass.findFirst({
    where: { attendee_id: target.attendeeId, provider_pass_id: target.providerPassId },
    select: { status: true, provider_removed_at: true, provider_commanded_at: true },
  });
  if (current?.status !== "active" || current.provider_removed_at) return "skipped";
  const commandedSince =
    target.providerCommandedAt !== undefined &&
    (target.providerCommandedAt?.getTime() ?? null) !== (current.provider_commanded_at?.getTime() ?? null);
  if (commandedSince) return "skipped";

  await provider.voidPass(target.providerPassId);
  return db.$transaction(async (tx): Promise<VoidWalletPassOutcome> => {
    const now = new Date();
    const { count } = await tx.walletPass.updateMany({
      // The pass identity and the state that was checked are part of the predicate, like the
      // removal helper's: a pass deleted and issued again, restored, expired or removed while the
      // provider call was in flight is not the pass this call voided, and its row must not be
      // marked voided.
      where: {
        attendee_id: target.attendeeId,
        provider_pass_id: target.providerPassId,
        provider_removed_at: null,
        status: "active",
        provider_commanded_at: current.provider_commanded_at,
      },
      data: { status: "voided", voided_at: now, provider_commanded_at: now, last_error_code: null },
    });
    // Changed, removed or replaced while this pass was being processed: nothing to mark.
    if (count === 0) return "skipped";
    await writeActionLog(tx, {
      event_id: eventId,
      attendee_id: target.attendeeId,
      action_type: "wallet_pass_voided",
      audit,
      metadata: { bulk: true, ...(options.eventWide ? { event_wide: true } : {}) },
    });
    return "voided";
  });
}
