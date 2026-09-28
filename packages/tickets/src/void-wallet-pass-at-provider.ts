import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";
import { writeActionLog, type OpsAuditContext } from "./ops-audit.js";

/** `voided` - this call voided the pass at the provider and recorded it locally. `skipped` - not
 * an active, still-managed pass (already voided or expired, or removed at the provider), or one
 * that was removed while this call was in flight. */
export type VoidWalletPassOutcome = "voided" | "skipped";

/**
 * Voids one active wallet pass at the provider and marks the local row `voided`. Shared by the
 * bulk "Void wallet pass" selection route and the event-wide wallet_void_active job, so the two
 * cannot drift apart: same eligibility rule, same conditional write, same action-log entry.
 *
 * Only an active, not-removed pass is touched. The provider call comes first and the local write
 * carries `provider_removed_at: null` in its where clause, so a Remove that lands while the
 * provider call is in flight is never overwritten with a `voided` status on a pass that no longer
 * exists there (the lesson every post-provider-call write on a pass row follows).
 */
export async function voidOneWalletPassAtProvider(
  db: PrismaClient,
  eventId: string,
  target: { attendeeId: string; providerPassId: string; status: string; providerRemovedAt: Date | null },
  provider: WalletPassProvider,
  audit: OpsAuditContext,
  options: { eventWide?: boolean } = {},
): Promise<VoidWalletPassOutcome> {
  if (target.status !== "active" || target.providerRemovedAt) return "skipped";
  await provider.voidPass(target.providerPassId);
  return db.$transaction(async (tx): Promise<VoidWalletPassOutcome> => {
    const now = new Date();
    const { count } = await tx.walletPass.updateMany({
      // The pass identity is part of the predicate, like the removal helper's: a pass deleted and
      // issued again while the provider call was in flight is a different pass this call never
      // voided, and its row must not be marked voided.
      where: { attendee_id: target.attendeeId, provider_pass_id: target.providerPassId, provider_removed_at: null },
      data: { status: "voided", voided_at: now, provider_commanded_at: now, last_error_code: null },
    });
    // Removed, or replaced by a different pass, while this one was being processed: nothing to mark.
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
