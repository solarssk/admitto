import { WalletProviderError, walletFailureCode } from "@admitto/wallet";
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
 * The failure code of a row that stays still to delete because a pass may be left in an account the event no longer
 * uses (`left_behind_pass_id`, see {@link verdictOf}). The creating request writes the same code on the row's
 * `last_error_code` for the attendee's page, but only the column decides: a later creation or failure overwrites the code.
 */
const CREDENTIALS_CHANGED_CODE = "wallet_credential_changed";

export type EraseWalletPassesResult = {
  /** Passes deleted at the provider (or already gone there) and marked as removed. */
  deleted: number;
  /** Passes the provider held under the id reserved for a pass that Admitto had not recorded (the only pass of a row,
   * or a second one beside the recorded pass: two creations at once can both succeed), found by that id and deleted.
   * Counted when found, also for a row that is not settled yet or that stays open for another reason. */
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
 * Which pass rows are still to be deleted at the provider once their attendee is erased: one whose `left_behind_pass_id`
 * is set, whatever else is on the row (a pass may be left in an account the event no longer uses, and nothing Admitto
 * does clears that, so not even a later removal of the recorded pass takes the row out of the question), or one that is
 * not marked removed and has one of
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
  OR: [
    { left_behind_pass_id: { not: null } },
    {
      provider_removed_at: null,
      OR: [{ provider_pass_id: { not: null } }, { user_provided_id: { not: null } }, { status: "failed" }],
    },
  ],
};

/** {@link PASS_ROW_STILL_AT_PROVIDER} for a row that has been read. */
export function passIsStillToDelete(pass: {
  provider_pass_id: string | null;
  user_provided_id: string | null;
  left_behind_pass_id: string | null;
  status: string;
  provider_removed_at: Date | null;
}): boolean {
  if (pass.left_behind_pass_id !== null) return true;
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
  left_behind_pass_id: string | null;
  issued_at: Date | null;
  attendee: { erased_at: Date | null };
};

/**
 * The id a pass is deleted by when Admitto has no provider id for it: the one its creating request reserved on the row
 * (`user_provided_id`) or, for a `failed` row written before ids were reserved, the one that request would have sent
 * (`walletUserProvidedId`). The provider answers from its own record of it. The one place this choice is made, for the
 * erasure's follow-up and for a removal alike.
 */
export function reservedPassId(eventId: string, pass: { attendee_id: string; user_provided_id: string | null }): string {
  return pass.user_provided_id ?? walletUserProvidedId(eventId, pass.attendee_id);
}

/** What a pass came to: the verdict on its row, and how many passes the provider held under the reserved id that Admitto
 * had not recorded (the only one of an unrecorded row, or a second one beside the recorded pass), found and deleted. The
 * verdict is "gone" (the row can be marked removed), "undecided" (there is none now, but a creation may still be on its
 * way, so the row stays as it is and the next run asks again) or "elsewhere" (a pass may be left in an account the event no
 * longer uses, see {@link verdictOf}). */
type Answer = { verdict: "gone" | "undecided" | "elsewhere"; found: number };

/** What became of one pass: gone, not yet decided or failed, each with how many unrecorded passes were found and deleted. */
type Outcome =
  | { kind: "gone"; untracked: number }
  | { kind: "undecided"; untracked: number }
  | { kind: "failed"; attendeeId: string; code: string; untracked: number };

/** How many passes under one reserved id a run deletes before it gives up on the row. The provider does not enforce the
 * uniqueness of that id strictly under concurrent creations, so there can be a second pass (two taps at once), but not many. */
const MAX_PASSES_UNDER_ONE_ID = 5;

/** Whether the erasure is old enough for "there is no pass" to be final (see {@link CREATION_SETTLE_WINDOW_MS}). */
function erasureIsSettled(erasedAt: Date | null): boolean {
  return erasedAt !== null && Date.now() - erasedAt.getTime() >= CREATION_SETTLE_WINDOW_MS;
}

/**
 * Whether nothing of this row can still be on its way to the provider: the erasure is old enough, or, for a recorded
 * pass, so is the creation that recorded it (a creation that overlapped it, and was given up on, lands within the same
 * window after it). A recorded pass of a person who was erased long after they got it is settled at once.
 */
function creationsAreSettled(pass: PassToDelete): boolean {
  if (erasureIsSettled(pass.attendee.erased_at)) return true;
  return pass.provider_pass_id !== null && pass.issued_at !== null && Date.now() - pass.issued_at.getTime() >= CREATION_SETTLE_WINDOW_MS;
}

/**
 * Deletes every pass the provider holds under `id`, one after the other, until it has none, and says how many there were.
 * Throws when it still finds one after {@link MAX_PASSES_UNDER_ONE_ID} deletions (a delete that does not take, or the same
 * pass answered again), so that the row stays still to delete with the failure code of the provider.
 */
export async function deletePassesUnder(provider: WalletPassProvider, id: string, deleted = 0): Promise<number> {
  if (!(await provider.deletePassByUserProvidedId(id))) return deleted;
  if (deleted >= MAX_PASSES_UNDER_ONE_ID) {
    throw new WalletProviderError("wallet_provider_rejected", "The provider still holds a pass under the reserved id.");
  }
  return deletePassesUnder(provider, id, deleted + 1);
}

/**
 * The verdict on a row once its passes are deleted. A row whose `left_behind_pass_id` is set is never settled: the
 * request that made the pass could not delete it in the account it made it in, which the event no longer uses, and
 * nothing the follow-up can see says which account a pass it finds (or does not find) is in, so only a person who
 * deleted the pass there can clear the marker (docs/dev/attendee-erasure.md). Otherwise an unrecorded pass that turned
 * up settles its row at once (the second look asks about the id again), and "there is none" settles it only when no
 * creation can still be on its way ({@link creationsAreSettled}).
 */
function verdictOf(pass: PassToDelete, found: boolean): Answer["verdict"] {
  if (pass.left_behind_pass_id !== null) return "elsewhere";
  if (found && pass.provider_pass_id === null) return "gone";
  return creationsAreSettled(pass) ? "gone" : "undecided";
}

/**
 * Deletes one pass at the provider: a row with the provider's id by it, then, for every row, whatever the provider holds
 * under the id reserved for it, which it answers from its own record. The second step is what finds an unrecorded pass,
 * and a second pass beside a recorded one.
 */
async function deleteAtProvider(provider: WalletPassProvider, eventId: string, pass: PassToDelete): Promise<Answer> {
  if (pass.provider_pass_id !== null) await provider.deletePass(pass.provider_pass_id);
  const reservedId = reservedPassId(eventId, pass);
  const found = await deletePassesUnder(provider, reservedId);
  return { found, verdict: verdictOf(pass, found > 0) };
}

async function deleteOne(
  db: PrismaClient,
  provider: WalletPassProvider,
  eventId: string,
  pass: PassToDelete,
): Promise<Outcome> {
  try {
    const { verdict, found } = await deleteAtProvider(provider, eventId, pass);
    if (verdict === "undecided") return { kind: "undecided", untracked: found };
    if (verdict === "elsewhere") return { kind: "failed", attendeeId: pass.attendee_id, code: CREDENTIALS_CHANGED_CODE, untracked: found };
    await db.walletPass.updateMany({
      // The provider's id as it was read: a row that was given one meanwhile (a creating request that finished after
      // this read) holds another pass, which is still to be deleted. The same for a pass left behind in another account
      // that a request recorded meanwhile.
      where: {
        attendee_id: pass.attendee_id,
        provider_pass_id: pass.provider_pass_id,
        provider_removed_at: null,
        left_behind_pass_id: null,
      },
      data: { provider_removed_at: new Date() },
    });
    return { kind: "gone", untracked: found };
  } catch (err) {
    return { kind: "failed", attendeeId: pass.attendee_id, code: walletFailureCode(err), untracked: 0 };
  }
}

/** Puts what became of one pass into the result: the count, or the attendee and the failure code. */
function recordOutcome(result: EraseWalletPassesResult, codes: Set<string>, outcome: Outcome): void {
  result.untrackedDeleted += outcome.untracked;
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
}

/**
 * Deletes, at the wallet provider, the passes of attendees whose personal data has been erased,
 * and marks each as removed (`provider_removed_at`) once the provider confirms. Run after the
 * erasure has committed: it is a network call, and the erasure keeps the pass row (with its ids) for exactly
 * this. A pass already marked removed is left alone (unless the row says a pass may be left in an account the event no
 * longer uses, see {@link verdictOf}), so calling it again for the same attendees retries only what failed. The pass
 * row is re-read here rather than taken from the erasure's own result, so a pass created by a request that raced the
 * erasure is found too.
 *
 * Every row is then asked for the id reserved for its pass before the provider was called, which the provider answers
 * from its own record, and whatever it holds under that id is deleted, until it has none. That is how a pass the
 * creating request could not record (see {@link PASS_ROW_STILL_AT_PROVIDER}: no provider id on the row, only that id)
 * is found, and also a second pass beside a recorded one (two creations at once can both succeed). A row of an
 * unrecorded pass that was found is marked removed at once (the sweep asks again, see
 * {@link recheckSettledWalletPasses}). "There is none" marks a row removed only when no creation can still be on its
 * way: the erasure is older than {@link CREATION_SETTLE_WINDOW_MS}, or, for a recorded pass, so is the creation that
 * recorded it. Before then the row is left as it is (`undecided`) and the next call asks again.
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
      left_behind_pass_id: true,
      issued_at: true,
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

/**
 * How long after a pass row was marked removed the daily sweep keeps asking the provider for the id reserved for it.
 * "There is none" is an answer about one moment: a creation can reach the provider after it in ways that nothing inside
 * one process can rule out (a process paused after its last check and before its send, a provider that lags behind its
 * own record, a clock that is off), and nothing else would look at a row that is marked removed. A week of asking turns
 * "never found" into "found within a day".
 */
export const SETTLED_RECHECK_HORIZON_MS = 7 * 24 * 3_600_000;

/** How many rows of one event a second look asks about in one call, in attendee id order. At the client's call spacing
 * a page takes longer than a sweep's whole budget, so the budget ends a run before a page is used up. */
const RECHECK_LIMIT = 1000;

/**
 * The rows the second look asks about, as far as the row goes: an unrecorded pass (no provider id, only the id reserved
 * for it, or a failed creation with none) that was marked removed since `since`. The attendee's part (erased, of this
 * event) is added by {@link recheckSettledWalletPasses}.
 */
export function settledUntrackedPassRow(since: Date): Prisma.WalletPassWhereInput {
  return {
    provider_pass_id: null,
    provider_removed_at: { gte: since },
    OR: [{ user_provided_id: { not: null } }, { status: "failed" }],
  };
}

/** What a second look did: how many ids the provider answered for, how many passes it held under them (deleted now), how many
 * ids it could not answer, whether rows were left unasked (the page was full, or the time ran out) and `last`, the attendee id of
 * the last row it asked about (null when it asked none), the place for the next run to go on after. */
export type RecheckSettledWalletPassesResult = {
  checked: number;
  found: number;
  failed: number;
  incomplete: boolean;
  last: string | null;
};

type PassToRecheck = { attendee_id: string; user_provided_id: string | null };

/** The part of an event's rows to look at, by attendee id: after `after` and up to `upTo`, either may be left out. */
function attendeeIdBetween(after: string | undefined, upTo: string | undefined): Prisma.WalletPassWhereInput {
  if (!after && !upTo) return {};
  return { attendee_id: { ...(after ? { gt: after } : {}), ...(upTo ? { lte: upTo } : {}) } };
}

/** Asks the provider for the passes of a settled row and deletes what it holds: how many there were, or "failed". */
async function recheckOne(provider: WalletPassProvider, eventId: string, pass: PassToRecheck): Promise<number | "failed"> {
  try {
    return await deletePassesUnder(provider, reservedPassId(eventId, pass));
  } catch {
    return "failed";
  }
}

/**
 * The second look at the unrecorded passes of erased attendees of one event that were marked removed within
 * {@link SETTLED_RECHECK_HORIZON_MS}, in attendee id order, after `after` and up to `upTo` (at most `limit`): asks the
 * provider for each reserved id again and deletes a pass that has turned up since the row was settled. It writes
 * nothing: the row stays marked removed, and a pass that is found says that an answer of "none" came too early, which
 * the caller reports. A failure only counts. The caller keeps `last` and goes on after it next time, so that a run that
 * is cut short by the limit or the time does not ask about the same first rows again and again while the rest of the
 * week passes (retention-settled-wallet-passes.ts). `budgetMs` bounds the whole run like it does for the deletes.
 */
export async function recheckSettledWalletPasses(
  db: PrismaClient,
  eventId: string,
  provider: WalletPassProvider,
  options: { budgetMs?: number; limit?: number; after?: string; upTo?: string } = {},
): Promise<RecheckSettledWalletPassesResult> {
  const result: RecheckSettledWalletPassesResult = { checked: 0, found: 0, failed: 0, incomplete: false, last: null };
  const limit = options.limit ?? RECHECK_LIMIT;
  const passes = await db.walletPass.findMany({
    where: {
      ...settledUntrackedPassRow(new Date(Date.now() - SETTLED_RECHECK_HORIZON_MS)),
      attendee: { event_id: eventId, erased_at: { not: null } },
      ...attendeeIdBetween(options.after, options.upTo),
    },
    select: { attendee_id: true, user_provided_id: true },
    orderBy: { attendee_id: "asc" },
    take: limit,
  });
  // A full page says that there may be more rows than were read.
  result.incomplete = passes.length === limit;
  const startedAt = Date.now();
  const runFrom = async (i: number): Promise<void> => {
    if (i >= passes.length) return;
    if (options.budgetMs !== undefined && Date.now() - startedAt >= options.budgetMs) {
      result.incomplete = true;
      return;
    }
    const batch = passes.slice(i, i + DELETE_CONCURRENCY);
    const outcomes = await Promise.all(batch.map((pass) => recheckOne(provider, eventId, pass)));
    for (const outcome of outcomes) {
      if (outcome === "failed") result.failed += 1;
      else {
        result.checked += 1;
        result.found += outcome;
      }
    }
    result.last = batch[batch.length - 1]!.attendee_id;
    await runFrom(i + DELETE_CONCURRENCY);
  };
  await runFrom(0);
  return result;
}
