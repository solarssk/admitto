import { walletFailureCode } from "@admitto/wallet";
import type { Prisma, PrismaClient } from "@admitto/db";
import type { WalletPassProvider } from "@admitto/wallet";
import { walletUserProvidedId } from "./wallet-pass-input.js";

const DELETE_CONCURRENCY = 8;

/**
 * How old an erasure has to be before a provider's "there is no pass under that id" counts as an answer. A request that
 * was creating the pass when the person was erased does not stop when the erasure commits, so its pass can still reach
 * the provider after that answer, and if the request dies or times out nothing clears the mark on the row afterwards.
 * Once the erasure is older than this, no such request can still send anything: `createPass` never sends its request
 * later than CREATE_PASS_DEADLINE_MS (2 minutes) after the check that the attendee was not erased, whatever it waited
 * for and however long the process was paused, the request itself ends within the client's 15 s timeout, and the
 * provider's own lag is seconds, so this is several times what a creation can take (a test keeps it at least 4 times
 * CREATE_PASS_DEADLINE_MS). A pass the provider does hold is deleted at once.
 */
export const CREATION_SETTLE_WINDOW_MS = 10 * 60_000;

/**
 * The `last_error_code` the creating request leaves on a pass row (`markFailed` in `handleWalletRedirect`) when the
 * event's wallet credentials changed while the pass was being made and that request could not delete the pass it made
 * with the old ones. The pass may then be in an account the event no longer uses, which the answer "no pass under that
 * id" of the account it uses now says nothing about: such a row is never settled on that answer.
 */
const CREDENTIALS_CHANGED_CODE = "wallet_credential_changed";

export type EraseWalletPassesResult = {
  /** Passes deleted at the provider (or already gone there) and marked as removed. */
  deleted: number;
  /** Of `deleted`, the passes Admitto had no provider id for that the provider did hold: found by the id reserved
   * for them and deleted. The others were gone already, or were never made. */
  untrackedDeleted: number;
  /** Passes the provider has none of, but whose creation may still have been under way when the person was erased (the
   * erasure is younger than {@link CREATION_SETTLE_WINDOW_MS}): not marked removed, so the next run asks again. */
  undecided: number;
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

type PassToDelete = {
  attendee_id: string;
  provider_pass_id: string | null;
  user_provided_id: string | null;
  last_error_code: string | null;
  attendee: { erased_at: Date | null };
};

/** What the provider said about one pass: it deleted a pass it held under the reserved id ("found"), the pass is gone
 * ("gone": deleted by its own id, or none under the reserved id and the erasure is old enough to rely on that), there
 * is none yet but one may still turn up ("undecided"), or there is none in the account the event uses now, but the
 * pass may be in another one ("elsewhere", see {@link CREDENTIALS_CHANGED_CODE}). */
type Settled = "gone" | "found" | "undecided" | "elsewhere";

/** What became of one pass: gone (and whether Admitto had no id for it, yet the provider held it), not yet decided, or failed. */
type Outcome =
  | { kind: "gone"; untracked: boolean }
  | { kind: "undecided" }
  | { kind: "failed"; attendeeId: string; code: string };

/** Whether the erasure is old enough for "there is no pass" to be final (see {@link CREATION_SETTLE_WINDOW_MS}). */
function erasureIsSettled(erasedAt: Date | null): boolean {
  return erasedAt !== null && Date.now() - erasedAt.getTime() >= CREATION_SETTLE_WINDOW_MS;
}

/**
 * Deletes one pass at the provider. A row with the provider's id is deleted by it. A row without one is deleted by the
 * id reserved for it, which the provider answers from its own record: a pass was deleted ("found"), or there was none,
 * which settles the row ("gone") only once the erasure is old enough, because a pass whose creation was already under
 * way can still reach the provider after that answer ("undecided"), and never when the row says the pass may be in an
 * account the event no longer uses ("elsewhere").
 */
async function deleteAtProvider(provider: WalletPassProvider, eventId: string, pass: PassToDelete): Promise<Settled> {
  if (pass.provider_pass_id !== null) {
    await provider.deletePass(pass.provider_pass_id);
    return "gone";
  }
  const found = await provider.deletePassByUserProvidedId(
    pass.user_provided_id ?? walletUserProvidedId(eventId, pass.attendee_id),
  );
  if (found) return "found";
  if (pass.last_error_code === CREDENTIALS_CHANGED_CODE) return "elsewhere";
  return erasureIsSettled(pass.attendee.erased_at) ? "gone" : "undecided";
}

async function deleteOne(
  db: PrismaClient,
  provider: WalletPassProvider,
  eventId: string,
  pass: PassToDelete,
): Promise<Outcome> {
  try {
    const settled = await deleteAtProvider(provider, eventId, pass);
    if (settled === "undecided") return { kind: "undecided" };
    if (settled === "elsewhere") return { kind: "failed", attendeeId: pass.attendee_id, code: CREDENTIALS_CHANGED_CODE };
    await db.walletPass.updateMany({
      // The provider's id as it was read: a row that was given one meanwhile (a creating request that finished after
      // this read) holds another pass, which is still to be deleted.
      where: { attendee_id: pass.attendee_id, provider_pass_id: pass.provider_pass_id, provider_removed_at: null },
      data: { provider_removed_at: new Date() },
    });
    return { kind: "gone", untracked: settled === "found" };
  } catch (err) {
    return { kind: "failed", attendeeId: pass.attendee_id, code: walletFailureCode(err) };
  }
}

/** Puts what became of one pass into the result: the count, or the attendee and the failure code. */
function recordOutcome(result: EraseWalletPassesResult, codes: Set<string>, outcome: Outcome): void {
  if (outcome.kind === "failed") {
    result.failedAttendeeIds.push(outcome.attendeeId);
    codes.add(outcome.code);
    return;
  }
  if (outcome.kind === "undecided") {
    result.undecided += 1;
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
 * provider's own record). A pass that was found is deleted and the row marked removed at once. "There is none" marks
 * the row removed only when the erasure is older than {@link CREATION_SETTLE_WINDOW_MS}: a request that was creating
 * the pass when the person was erased can still finish at the provider after that answer, so before then the row is
 * left as it is (`undecided`) and the next call asks again.
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
    undecided: 0,
    failedAttendeeIds: [],
    failureCodes: [],
    notTried: 0,
  };
  if (attendeeIds.length === 0) return result;
  const passes = await db.walletPass.findMany({
    where: erasedPassToDeleteWhere(eventId, attendeeIds),
    select: {
      attendee_id: true,
      provider_pass_id: true,
      user_provided_id: true,
      last_error_code: true,
      attendee: { select: { erased_at: true } },
    },
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
