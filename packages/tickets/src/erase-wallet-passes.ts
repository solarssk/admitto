import type { PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";

const DELETE_CONCURRENCY = 8;

export type EraseWalletPassesResult = {
  /** Passes deleted at the provider (or already gone there) and marked as removed. */
  deleted: number;
  /** Attendees whose pass could not be deleted: it stays marked "still to delete" for a retry. */
  failedAttendeeIds: string[];
  /** Why they failed (the provider's error code, or "unknown"), without repeats. */
  failureCodes: string[];
  /** Passes not tried because the time budget ran out: they stay marked "still to delete" too. */
  notTried: number;
};

function failureCode(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : "unknown";
}

/**
 * Deletes, at the wallet provider, the passes of attendees whose personal data has been erased,
 * and marks each as removed (`provider_removed_at`) once the provider confirms. Run after the
 * erasure has committed: it is a network call, and the erasure keeps the provider ids on the pass
 * row for exactly this. A pass already marked removed is left alone, so calling it again for the
 * same attendees retries only what failed. The pass row is re-read here rather than taken from the
 * erasure's own result, so a pass created by a request that raced the erasure is found too.
 *
 * Deleting at the provider is idempotent (a pass that is already gone counts as deleted), and a
 * failure for one pass never stops the others. `budgetMs` bounds how long the whole run may take:
 * no new batch starts once it has passed (a slow provider must not outlast the HTTP request that
 * called this), and what was not tried is reported in `notTried` for the next call: the passes go in attendee id
 * order, so those are the `notTried` highest of the ids given.
 */
export async function deleteErasedWalletPasses(
  db: PrismaClient,
  eventId: string,
  attendeeIds: readonly string[],
  provider: WalletPassProvider,
  options: { budgetMs?: number } = {},
): Promise<EraseWalletPassesResult> {
  const result: EraseWalletPassesResult = { deleted: 0, failedAttendeeIds: [], failureCodes: [], notTried: 0 };
  if (attendeeIds.length === 0) return result;
  const passes = await db.walletPass.findMany({
    where: {
      attendee_id: { in: [...attendeeIds] },
      provider_pass_id: { not: null },
      provider_removed_at: null,
      // Only erased attendees of this event: this never deletes a live attendee's pass.
      attendee: { event_id: eventId, erased_at: { not: null } },
    },
    select: { attendee_id: true, provider_pass_id: true },
    // In attendee id order, so that what was not tried (`notTried`) is the last of the ids, and a caller that
    // walks the passes in that order knows where it stopped.
    orderBy: { attendee_id: "asc" },
  });

  const startedAt = Date.now();
  const codes = new Set<string>();
  // One batch after the other, so the budget is checked between them: no loop with an await in it.
  const runFrom = async (i: number): Promise<void> => {
    if (i >= passes.length) return;
    if (options.budgetMs !== undefined && Date.now() - startedAt >= options.budgetMs) {
      result.notTried = passes.length - i;
      return;
    }
    const batch = passes.slice(i, i + DELETE_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (pass): Promise<{ failed: string; code: string } | null> => {
        try {
          await provider.deletePass(pass.provider_pass_id!);
          await db.walletPass.updateMany({
            where: { attendee_id: pass.attendee_id, provider_pass_id: pass.provider_pass_id, provider_removed_at: null },
            data: { provider_removed_at: new Date() },
          });
          return null;
        } catch (err) {
          return { failed: pass.attendee_id, code: failureCode(err) };
        }
      }),
    );
    for (const outcome of outcomes) {
      if (outcome === null) {
        result.deleted += 1;
      } else {
        result.failedAttendeeIds.push(outcome.failed);
        codes.add(outcome.code);
      }
    }
    await runFrom(i + DELETE_CONCURRENCY);
  };
  await runFrom(0);
  result.failureCodes = [...codes];
  return result;
}
