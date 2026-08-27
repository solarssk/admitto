import type { PrismaClient } from "@admitto/db";

export interface CancelBulkSendBatchResult {
  /** Rows flipped from "queued" to "cancelled" by this call. */
  cancelled: number;
}

/**
 * Stop a still-draining bulk-send batch. Only rows still `status: "queued"` for this
 * (event, batch) pair are touched - a guarded `updateMany`, not a blind write, so this can never
 * clobber a row that a concurrent process (the drain worker finishing it, or bounce ingest
 * flipping it straight to "bounced") has already moved past "queued".
 *
 * This alone does not guarantee nothing more goes out: the drain worker (drain.ts) claims rows
 * via a plain SELECT, so a row already read into its current tick's in-memory batch keeps DB
 * status "queued" until actually sent. sendOneFromSnapshot re-checks each row's live status
 * immediately before calling the mailer and skips anything this function has since marked
 * "cancelled" - that pairing is what makes cancellation apply to everything except whatever one
 * row is already mid-send at the moment this runs (an email already handed to the mailer can't
 * be unsent).
 */
export async function cancelBulkSendBatch(
  prisma: PrismaClient,
  eventId: string,
  batchId: string,
): Promise<CancelBulkSendBatchResult> {
  const result = await prisma.emailDelivery.updateMany({
    where: { event_id: eventId, batch_id: batchId, status: "queued" },
    data: { status: "cancelled" },
  });
  return { cancelled: result.count };
}
