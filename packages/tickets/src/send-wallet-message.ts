import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";
import { liveAttendeeIds } from "./lock-check.js";

/** No documented cap on PassCreator's bulk `filter.identifiers` size, but a chunk keeps one
 * event's send from hinging on a single unbounded request - conservative default pending live
 * confirmation (see PassCreatorClient.sendPushMessage). */
export const WALLET_MESSAGE_BULK_BATCH_SIZE = 500;

export type SendWalletMessageTarget = { attendeeId: string; providerPassId: string };

/**
 * The targets of one batch whose attendee still exists and is not erased, checked under their row
 * locks right before the batch goes out. The targets were selected earlier, and a large send spans
 * several provider calls: an attendee erased in between must not be messaged, and an erasure that
 * is still open is waited for rather than read as it was before it began.
 */
export async function keepLiveWalletMessageTargets(
  db: PrismaClient,
  batch: SendWalletMessageTarget[],
): Promise<SendWalletMessageTarget[]> {
  const live = await liveAttendeeIds(
    db,
    batch.map((target) => target.attendeeId),
  );
  return batch.filter((target) => live.has(target.attendeeId));
}

export type SendWalletMessageOptions = {
  /** Called with each batch right before it goes out; returns the targets that may still be sent.
   * Targets it leaves out count as `skipped`; if it throws, the whole batch counts as errored. */
  beforeBatch?: (batch: SendWalletMessageTarget[]) => Promise<SendWalletMessageTarget[]>;
};

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
      // An erased attendee's pass is still active until the erasure has deleted it at the
      // provider: they are not messaged in the meantime.
      attendee: { event_id: eventId, erased_at: null },
    },
    select: { attendee_id: true, provider_pass_id: true },
  });
  return rows.map((row) => ({ attendeeId: row.attendee_id, providerPassId: row.provider_pass_id! }));
}

export type SendWalletMessageResult = {
  /** Count of targets in a batch PassCreator's bulk push call accepted, not a confirmed
   * on-device delivery - like wallet_push's own "reissued" count, neither PassCreator nor
   * Apple/Google expose a synchronous delivery receipt for this, so "accepted the request" is
   * the strongest signal available here. */
  sent: number;
  errored: number;
  /** Targets left out because `beforeBatch` no longer allowed them (erased since the selection). */
  skipped: number;
  /** attendeeId of every target in a batch that failed - the actual retry set a caller needs to
   * re-message only what didn't go out, not the full original selection (which would duplicate
   * already-successful batches). */
  erroredAttendeeIds: string[];
};

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
  options: SendWalletMessageOptions = {},
): Promise<SendWalletMessageResult> {
  let sent = 0;
  let skipped = 0;
  const erroredAttendeeIds: string[] = [];
  const batches = chunk(targets, WALLET_MESSAGE_BULK_BATCH_SIZE);

  // One batch after the other, never concurrently: each is checked just before it goes out, so a
  // later batch sees what changed while the earlier ones were with the provider.
  const sendFrom = async (index: number): Promise<void> => {
    const batch = batches.at(index);
    if (!batch) return;
    const outcome = await sendOneBatch(provider, batch, text, options.beforeBatch);
    sent += outcome.sent;
    skipped += outcome.skipped;
    erroredAttendeeIds.push(...outcome.erroredAttendeeIds);
    try {
      // Progress is advisory (polling UI only) - a write failure here must not turn a batch the
      // provider already accepted into a reported failure, which would risk an operator retry
      // re-sending a notification that already reached its recipients.
      await onProgress?.(sent + skipped + erroredAttendeeIds.length);
    } catch (err) {
      console.error("wallet message progress update failed:", err);
    }
    await sendFrom(index + 1);
  };
  await sendFrom(0);

  return { sent, errored: erroredAttendeeIds.length, skipped, erroredAttendeeIds };
}

type BatchOutcome = { sent: number; skipped: number; erroredAttendeeIds: string[] };

/** One bulk call: the targets the check keeps are sent, the others are skipped, and a failure of
 * the check or of the call puts the targets it concerned into the retry set. */
async function sendOneBatch(
  provider: WalletPassProvider,
  batch: SendWalletMessageTarget[],
  text: string,
  beforeBatch: SendWalletMessageOptions["beforeBatch"],
): Promise<BatchOutcome> {
  const sendable = await selectSendable(batch, beforeBatch);
  // The check itself failed: nothing of this batch went out, so all of it can be retried.
  if (sendable === null) return { sent: 0, skipped: 0, erroredAttendeeIds: attendeeIdsOf(batch) };
  const skipped = batch.length - sendable.length;
  if (sendable.length === 0) return { sent: 0, skipped, erroredAttendeeIds: [] };
  try {
    await provider.sendPushMessage(
      sendable.map((target) => target.providerPassId),
      text,
    );
    return { sent: sendable.length, skipped, erroredAttendeeIds: [] };
  } catch {
    return { sent: 0, skipped, erroredAttendeeIds: attendeeIdsOf(sendable) };
  }
}

const attendeeIdsOf = (targets: SendWalletMessageTarget[]): string[] => targets.map((target) => target.attendeeId);

/** The part of a batch that may go out, or null when the check could not be made. */
async function selectSendable(
  batch: SendWalletMessageTarget[],
  beforeBatch: SendWalletMessageOptions["beforeBatch"],
): Promise<SendWalletMessageTarget[] | null> {
  if (!beforeBatch) return batch;
  try {
    return await beforeBatch(batch);
  } catch {
    return null;
  }
}
