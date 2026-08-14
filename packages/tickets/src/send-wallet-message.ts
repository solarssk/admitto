import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";

/** No documented cap on PassCreator's bulk `filter.identifiers` size, but a chunk keeps one
 * event's send from hinging on a single unbounded request - conservative default pending live
 * confirmation (see PassCreatorClient.sendPushMessage). */
export const WALLET_MESSAGE_BULK_BATCH_SIZE = 500;

export type SendWalletMessageTarget = { attendeeId: string; providerPassId: string };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Resolves which of the given attendees currently have an active, issued wallet pass -
 * attendees with no pass, a pending pass, or a voided one are silently skipped rather than
 * erroring, since a caller-selected filter (e.g. "all attendees with a wallet") can still
 * include a stale id by the time the job actually runs. Same "active, has a provider id" bar as
 * wallet_push's own target resolution.
 */
export async function loadWalletMessageTargets(
  db: PrismaClient,
  eventId: string,
  attendeeIds: string[],
): Promise<SendWalletMessageTarget[]> {
  const rows = await db.walletPass.findMany({
    where: {
      attendee_id: { in: attendeeIds },
      provider_pass_id: { not: null },
      status: "active",
      attendee: { event_id: eventId },
    },
    select: { attendee_id: true, provider_pass_id: true },
  });
  return rows.map((row) => ({ attendeeId: row.attendee_id, providerPassId: row.provider_pass_id! }));
}

export type SendWalletMessageResult = { sent: number; errored: number };

/** Called after each batch (whether it succeeded or failed) so a caller can persist incremental
 * job progress - a large send can span several batches, and progress would otherwise sit frozen
 * until the entire send finishes. */
export type SendWalletMessageProgress = (doneCount: number) => Promise<void>;

/**
 * Sends one custom push message to every target's installed wallet pass, batched at
 * WALLET_MESSAGE_BULK_BATCH_SIZE - each batch is one PassCreator bulk call (not one call per
 * attendee), issued sequentially rather than concurrently to stay predictable against
 * PassCreator's own account-wide rate limit.
 *
 * A failed batch does not abort the remaining ones (same philosophy as wallet_push's per-target
 * error isolation, just at batch granularity - a single bulk call either reaches every recipient
 * in it or none, so that's the smallest unit of failure this can report): the batch's own targets
 * count as `errored`, and the send continues. A caller retrying only the reported-errored
 * attendees will not re-message anyone already reached by a batch that succeeded earlier - the
 * previous all-or-nothing behavior (any batch failing threw and left the whole job "failed" with
 * no record of what already went out) risked exactly that kind of duplicate push on retry.
 */
export async function sendWalletMessage(
  provider: WalletPassProvider,
  targets: SendWalletMessageTarget[],
  text: string,
  onProgress?: SendWalletMessageProgress,
): Promise<SendWalletMessageResult> {
  let sent = 0;
  let errored = 0;
  for (const batch of chunk(targets, WALLET_MESSAGE_BULK_BATCH_SIZE)) {
    try {
      await provider.sendPushMessage(
        batch.map((target) => target.providerPassId),
        text,
      );
      sent += batch.length;
    } catch {
      errored += batch.length;
    }
    await onProgress?.(sent + errored);
  }
  return { sent, errored };
}
