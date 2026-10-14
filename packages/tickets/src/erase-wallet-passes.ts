import { walletFailureCode } from "@admitto/wallet";
import type { Prisma, PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";
import { walletUserProvidedId } from "./wallet-pass-input.js";

const DELETE_CONCURRENCY = 8;

export type EraseWalletPassesResult = {
  /** Passes deleted at the provider (or already gone there) and marked as removed. */
  deleted: number;
  /** Of `deleted`, the passes Admitto had no provider id for that the provider did hold: found by the id reserved
   * for them and deleted. The others were gone already, or were never made. */
  untrackedDeleted: number;
  /** Attendees whose pass could not be deleted: it stays marked "still to delete" for a retry. */
  failedAttendeeIds: string[];
  /** Why they failed (the provider's error code, or "unknown"), without repeats. */
  failureCodes: string[];
  /** Passes not tried because the time budget ran out: they stay marked "still to delete" too. */
  notTried: number;
};

/**
 * Which pass rows are still to be deleted at the provider once their attendee is erased: not marked removed, and one of
 * - the provider's id for the pass is on the row (the usual case);
 * - the id the pass has at the provider (`user_provided_id`) is on the row and the provider's id is not. The creating
 *   request writes it before it calls the provider (handleWalletRedirect), so a pass may exist that the request could
 *   not record (the save failed, the event's template changed meanwhile, the process died) or has not recorded yet;
 * - the row says a creation failed (`status` "failed") and holds neither: written before the id was reserved, by a
 *   request whose pass may still have been made (a timeout, or a result that request then dropped).
 * The last two are deleted by the id the pass was to get, `walletUserProvidedId`. This is the row's part of the
 * question; {@link erasedPassToDeleteWhere} adds who the attendee is.
 */
export const PASS_ROW_STILL_AT_PROVIDER: Prisma.WalletPassWhereInput = {
  provider_removed_at: null,
  OR: [{ provider_pass_id: { not: null } }, { user_provided_id: { not: null } }, { status: "failed" }],
};

/** {@link PASS_ROW_STILL_AT_PROVIDER} for a row that has been read. */
export function passIsStillToDelete(pass: {
  provider_pass_id: string | null;
  user_provided_id: string | null;
  status: string;
  provider_removed_at: Date | null;
}): boolean {
  if (pass.provider_removed_at !== null) return false;
  return pass.provider_pass_id !== null || pass.user_provided_id !== null || pass.status === "failed";
}

/**
 * The passes still to be deleted of the erased attendees of one event (of the given ones, when `attendeeIds` is set).
 * The one place that says what "still to delete" means, for the erase API, the command and the retention sweep alike:
 * only an erased attendee of this event matches, so a live attendee's pass is never deleted by it.
 */
export function erasedPassToDeleteWhere(eventId: string, attendeeIds?: readonly string[]): Prisma.WalletPassWhereInput {
  return {
    ...PASS_ROW_STILL_AT_PROVIDER,
    attendee: { event_id: eventId, erased_at: { not: null } },
    ...(attendeeIds ? { attendee_id: { in: [...attendeeIds] } } : {}),
  };
}

type PassToDelete = { attendee_id: string; provider_pass_id: string | null; user_provided_id: string | null };

/**
 * The id a pass is deleted by when Admitto has no provider id for it: the one its creating request reserved on the row
 * (`user_provided_id`) or, for a `failed` row written before ids were reserved, the one that request would have sent
 * (`walletUserProvidedId`). The provider answers from its own record of it. The one place this choice is made, for the
 * erasure's follow-up and for a removal alike.
 */
export function reservedPassId(eventId: string, pass: { attendee_id: string; user_provided_id: string | null }): string {
  return pass.user_provided_id ?? walletUserProvidedId(eventId, pass.attendee_id);
}

/** What became of one pass: it is gone (and whether Admitto had no id for it, yet the provider held it), or it failed. */
type Outcome = { ok: true; untracked: boolean } | { ok: false; attendeeId: string; code: string };

/**
 * Deletes one pass at the provider and says whether it was one Admitto had no id for that the provider held. A row
 * with the provider's id is deleted by it. A row without one is deleted by the id reserved for it, which the provider
 * answers from its own record: a pass was deleted (true) or there was none (false), and either way it is gone.
 */
async function deleteAtProvider(provider: WalletPassProvider, eventId: string, pass: PassToDelete): Promise<boolean> {
  if (pass.provider_pass_id !== null) {
    await provider.deletePass(pass.provider_pass_id);
    return false;
  }
  return provider.deletePassByUserProvidedId(reservedPassId(eventId, pass));
}

async function deleteOne(
  db: PrismaClient,
  provider: WalletPassProvider,
  eventId: string,
  pass: PassToDelete,
): Promise<Outcome> {
  try {
    const untracked = await deleteAtProvider(provider, eventId, pass);
    await db.walletPass.updateMany({
      // The provider's id as it was read: a row that was given one meanwhile (a creating request that finished after
      // this read) holds another pass, which is still to be deleted.
      where: { attendee_id: pass.attendee_id, provider_pass_id: pass.provider_pass_id, provider_removed_at: null },
      data: { provider_removed_at: new Date() },
    });
    return { ok: true, untracked };
  } catch (err) {
    return { ok: false, attendeeId: pass.attendee_id, code: walletFailureCode(err) };
  }
}

/** Puts what became of one pass into the result: the count, or the attendee and the failure code. */
function recordOutcome(result: EraseWalletPassesResult, codes: Set<string>, outcome: Outcome): void {
  if (!outcome.ok) {
    result.failedAttendeeIds.push(outcome.attendeeId);
    codes.add(outcome.code);
    return;
  }
  result.deleted += 1;
  if (outcome.untracked) result.untrackedDeleted += 1;
}

/**
 * Deletes, at the wallet provider, the passes of attendees whose personal data has been erased,
 * and marks each as removed (`provider_removed_at`) once the provider confirms. Run after the
 * erasure has committed: it is a network call, and the erasure keeps the pass row (with its ids) for exactly
 * this. A pass already marked removed is left alone, so calling it again for the
 * same attendees retries only what failed. The pass row is re-read here rather than taken from the
 * erasure's own result, so a pass created by a request that raced the erasure is found too.
 *
 * A pass the creating request could not record (see {@link PASS_ROW_STILL_AT_PROVIDER}) has no provider id on its row,
 * only the id reserved for it before the provider was called: it is deleted by that id (one call, answered by the
 * provider's own record, so "there is none" is a real answer and the row is marked removed too).
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
  const result: EraseWalletPassesResult = {
    deleted: 0,
    untrackedDeleted: 0,
    failedAttendeeIds: [],
    failureCodes: [],
    notTried: 0,
  };
  if (attendeeIds.length === 0) return result;
  const passes = await db.walletPass.findMany({
    where: erasedPassToDeleteWhere(eventId, attendeeIds),
    select: { attendee_id: true, provider_pass_id: true, user_provided_id: true },
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
    const outcomes = await Promise.all(batch.map((pass) => deleteOne(db, provider, eventId, pass)));
    for (const outcome of outcomes) recordOutcome(result, codes, outcome);
    await runFrom(i + DELETE_CONCURRENCY);
  };
  await runFrom(0);
  result.failureCodes = [...codes];
  return result;
}
