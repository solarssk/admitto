import type { Prisma, PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  PASS_ROW_STILL_AT_PROVIDER,
  deleteErasedWalletPasses,
  erasedPassToDeleteWhere,
  parseWalletFieldMapping,
  type EraseWalletPassesResult,
} from "@admitto/tickets";
import { resolveConfiguredWalletProvider, type WalletPassProvider } from "@admitto/wallet";

/** How long one sweep may spend at the provider. The worker's retention job holds up the next drain while it runs. */
const DEFAULT_BUDGET_MS = 60_000;
const PAGE_SIZE = 100;
/** How many attendee ids one log line of failures names. The worker relays each line to the app in a request of its own,
 * and that endpoint takes 120 a minute, so a run with hundreds of failures must not write a line for each. */
const MAX_FAILED_IDS_LOGGED = 15;
/** Where the last sweep that ran out of time stopped (a SystemSettings row), so that the next one goes on from there. */
export const SWEEP_CURSOR_KEY = "retention.erased_wallet_sweep_cursor";

/** The last pass a sweep tried: the sweep goes by event id, then attendee id. */
type Cursor = { eventId: string; attendeeId: string };

/** What one sweep over the wallet passes of erased attendees did (or, in a dry run, found). */
export type ErasedWalletSweepResult = {
  /** Passes of erased attendees that were still to be deleted at the provider when the sweep looked. */
  pending: number;
  /** Deleted at the provider (or already gone there) and marked as removed. */
  deleted: number;
  /** The provider refused or could not be reached: they stay marked "still to delete". */
  failed: number;
  /** The provider has none, but a creation may still have been under way when the person was erased: they stay marked
   * "still to delete" and the next sweep asks again, once the erasure is old enough. */
  undecided: number;
  /** Their event has no wallet credentials the sweep can use, so nothing was tried. */
  noProvider: number;
  /** Not tried because the time budget ran out. */
  notTried: number;
};

/** Passes of erased attendees that are still to be deleted after a sweep: the ones that failed, are not decided yet, could not be tried, or had no credentials. */
export function erasedWalletPassesLeft(result: ErasedWalletSweepResult): number {
  return result.failed + result.undecided + result.noProvider + result.notTried;
}

/** The columns of an event that say which wallet provider account its passes live in. */
export type EventWalletCredentials = {
  wallet_template_id: string | null;
  wallet_api_key_enc: string | null;
  wallet_field_mapping: unknown;
};

/** The event's wallet provider, from its credentials alone (the Wallet switch only governs issuing new passes), or null. */
export function resolveEventWalletProvider(event: EventWalletCredentials): WalletPassProvider | null {
  return resolveConfiguredWalletProvider({
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
  });
}

type EventToSweep = EventWalletCredentials & { id: string };

/** What the sweep needs from outside, so a test can stand in for the provider and the clock. */
export type ErasedWalletSweepDeps = {
  resolveProvider: (event: EventToSweep) => WalletPassProvider | null;
  deletePasses: typeof deleteErasedWalletPasses;
  nowMs: () => number;
};

const realDeps: ErasedWalletSweepDeps = {
  resolveProvider: resolveEventWalletProvider,
  deletePasses: deleteErasedWalletPasses,
  nowMs: () => Date.now(),
};

/**
 * The same question the erase API asks after an erasure: a pass still to be deleted at the provider (it has the
 * provider's id, or only the id reserved for it, and is not yet removed) of an erased attendee (of the given ones,
 * when `attendeeIds` is set).
 */
export function passToDelete(eventId: string, attendeeIds?: readonly string[]): Prisma.WalletPassWhereInput {
  return erasedPassToDeleteWhere(eventId, attendeeIds);
}

type Tally = { deleted: number; failed: number; undecided: number; exhausted: boolean; last: Cursor | null };

/** The part of an event's passes to try: after `after` and up to `upTo` (attendee ids), either may be left out. */
type Range = { after?: string; upTo?: string };

async function readCursor(db: PrismaClient): Promise<Cursor | null> {
  try {
    const row = await db.systemSettings.findUnique({ where: { key: SWEEP_CURSOR_KEY } });
    if (!row) return null;
    const parsed = JSON.parse(row.value_json) as Partial<Cursor>;
    return typeof parsed.eventId === "string" && typeof parsed.attendeeId === "string"
      ? { eventId: parsed.eventId, attendeeId: parsed.attendeeId }
      : null;
  } catch {
    // Without it the sweep starts from the beginning, which is what it did before it kept a place.
    return null;
  }
}

/** Keeps the place (or forgets it, with null). A failure to do so only costs the next sweep its head start. */
async function writeCursor(db: PrismaClient, cursor: Cursor | null): Promise<void> {
  try {
    if (cursor === null) {
      await db.systemSettings.deleteMany({ where: { key: SWEEP_CURSOR_KEY } });
      return;
    }
    const value_json = JSON.stringify(cursor);
    await db.systemSettings.upsert({ where: { key: SWEEP_CURSOR_KEY }, create: { key: SWEEP_CURSOR_KEY, value_json }, update: { value_json } });
  } catch {
    emitSystemLog("wallet", "warn", "wallet_pass_sweep_cursor_not_saved", {});
  }
}

/** What one walk of an event has to tell in its lines: the passes the provider refused, and how many passes it held
 * that Admitto had no id for (found by the id reserved for them, and deleted). */
type Failures = { attendeeIds: string[]; codes: Set<string>; untracked: number };

/**
 * One line for the whole walk of an event, however many passes failed (the worker relays every line to the app in
 * a request of its own, and that endpoint takes 120 a minute, so a line for each of hundreds of failing passes would
 * push the later lines, and the summary of the run, out): how many, the failure codes, and the first attendee ids.
 * The ids are pseudonyms once the person is erased, never a name or an address.
 */
function reportFailures(eventId: string, failures: Failures): void {
  if (failures.attendeeIds.length === 0) return;
  const more = failures.attendeeIds.length - MAX_FAILED_IDS_LOGGED;
  emitSystemLog("wallet", "error", "wallet_pass_erasure_delete_failed", {
    eventId,
    failed: failures.attendeeIds.length,
    codes: [...failures.codes].join(","),
    attendeeIds: failures.attendeeIds.slice(0, MAX_FAILED_IDS_LOGGED).join(","),
    ...(more > 0 ? { more } : {}),
  });
}

/**
 * One line for the whole walk of an event, however many passes it found that Admitto had no record of (a pass whose
 * creating request could not save it): it is the one sign that this happened, so the operator should be able to see
 * it, and where. The event's id only, never an attendee's.
 */
function reportUntracked(eventId: string, untracked: number): void {
  if (untracked <= 0) return;
  emitSystemLog("wallet", "warn", "wallet_pass_untracked_deleted", { eventId, deleted: untracked });
}

/** What the walk of an event needs, so that the functions below take few parameters. */
type Walk = {
  db: PrismaClient;
  provider: WalletPassProvider;
  budget: { startedAt: number; ms: number };
  deps: ErasedWalletSweepDeps;
  tally: Tally;
};

/** The ids of the next page of an event's pending passes, in attendee id order, after `after` and up to `upTo`. */
async function readPage(db: PrismaClient, eventId: string, after: string | undefined, upTo: string | undefined): Promise<string[]> {
  const idRange = after || upTo ? { attendee_id: { ...(after ? { gt: after } : {}), ...(upTo ? { lte: upTo } : {}) } } : {};
  const page = await db.walletPass.findMany({
    where: { ...passToDelete(eventId), ...idRange },
    select: { attendee_id: true },
    orderBy: { attendee_id: "asc" },
    take: PAGE_SIZE,
  });
  return page.map((pass) => pass.attendee_id);
}

/**
 * Puts what one page of deletions did into the books, and says whether the walk has to stop: it does when the page
 * was not all tried (the budget ran out). The last pass tried goes into `tally.last`, which is what lets the next
 * sweep go on after it; deleteErasedWalletPasses goes by attendee id too, so what it did not try is the end of the page.
 */
function recordRun(walk: Walk, eventId: string, attendeeIds: string[], run: EraseWalletPassesResult, failures: Failures): boolean {
  const { tally } = walk;
  tally.deleted += run.deleted;
  tally.failed += run.failedAttendeeIds.length;
  tally.undecided += run.undecided;
  failures.untracked += run.untrackedDeleted;
  failures.attendeeIds.push(...run.failedAttendeeIds);
  for (const code of run.failureCodes) failures.codes.add(code);
  const tried = attendeeIds.length - run.notTried;
  if (tried > 0) tally.last = { eventId, attendeeId: attendeeIds[tried - 1]! };
  if (run.notTried === 0) return false;
  tally.exhausted = true;
  return true;
}

/**
 * Deletes the pending passes of one event in `range`, a page at a time (by attendee id, so a page of passes that
 * stay cannot be read again), until none are left or the budget is gone, and says in one line which failed.
 */
async function sweepEvent(walk: Walk, eventId: string, range: Range = {}): Promise<void> {
  const failures: Failures = { attendeeIds: [], codes: new Set(), untracked: 0 };
  try {
    let cursor = range.after;
    for (;;) {
      const remainingMs = walk.budget.ms - (walk.deps.nowMs() - walk.budget.startedAt);
      if (remainingMs <= 0) {
        walk.tally.exhausted = true;
        return;
      }
      const attendeeIds = await readPage(walk.db, eventId, cursor, range.upTo);
      if (attendeeIds.length === 0) return;
      const run = await walk.deps.deletePasses(walk.db, eventId, attendeeIds, walk.provider, { budgetMs: remainingMs });
      if (recordRun(walk, eventId, attendeeIds, run, failures) || attendeeIds.length < PAGE_SIZE) return;
      cursor = attendeeIds.at(-1);
    }
  } finally {
    // Also when the walk stops on an error: what failed, and what was found, before it is still worth a line.
    reportFailures(eventId, failures);
    reportUntracked(eventId, failures.untracked);
  }
}

type Sweepable = { event: EventToSweep; provider: WalletPassProvider };

/**
 * The events and the parts of them to try, in the order of this sweep: after `cursor` (the last pass the sweep
 * before it tried), to the end, then from the beginning up to it. A sweep that ran out of time therefore goes on
 * where it stopped instead of trying the same first passes again, and a pass that keeps failing cannot keep the
 * ones behind it from being tried. Without a cursor it is the order by event id, then attendee id.
 */
function inSweepOrder(items: Sweepable[], cursor: Cursor | null): Array<Sweepable & { range: Range }> {
  const whole = (item: Sweepable) => ({ ...item, range: {} });
  if (!cursor) return items.map(whole);
  const own = items.find((item) => item.event.id === cursor.eventId);
  return [
    ...(own ? [{ ...own, range: { after: cursor.attendeeId } }] : []),
    ...items.filter((item) => item.event.id > cursor.eventId).map(whole),
    ...items.filter((item) => item.event.id < cursor.eventId).map(whole),
    ...(own ? [{ ...own, range: { upTo: cursor.attendeeId } }] : []),
  ];
}

/** Counts what is pending in each event and picks the ones the sweep can try (a dry run counts only). */
async function surveyEvents(
  db: PrismaClient,
  events: EventToSweep[],
  options: { dryRun: boolean },
  deps: ErasedWalletSweepDeps,
  result: ErasedWalletSweepResult,
): Promise<{ sweepable: Sweepable[]; tryable: number }> {
  const sweepable: Sweepable[] = [];
  let tryable = 0;
  for (const event of events) {
    const pending = await db.walletPass.count({ where: passToDelete(event.id) }); // NOSONAR - one event at a time on purpose: the events share one time budget and the provider must not be burst
    result.pending += pending;
    if (options.dryRun || pending === 0) continue;
    const provider = deps.resolveProvider(event);
    if (!provider) {
      result.noProvider += pending;
      // The summary only counts, so this is where an operator finds out which event needs its credentials.
      emitSystemLog("wallet", "warn", "wallet_pass_erasure_no_provider", { eventId: event.id, pending });
      continue;
    }
    tryable += pending;
    sweepable.push({ event, provider });
  }
  return { sweepable, tryable };
}

/** Keeps the place where the sweep ran out of time, or forgets it when the sweep got through everything. */
async function keepPlace(db: PrismaClient, tally: Tally, before: Cursor | null): Promise<void> {
  if (tally.exhausted) {
    if (tally.last) await writeCursor(db, tally.last);
  } else if (before) {
    await writeCursor(db, null);
  }
}

/**
 * Retries, at the wallet provider, the deletion of passes of attendees whose personal data was erased: the
 * erase API deletes them right after the commit, but a provider that was down, an event whose credentials were
 * missing then, or a request that ran out of time leaves the pass marked "still to delete", and nothing else
 * retried it. Runs from the worker's retention job and `admitto retention run`. `deleteErasedWalletPasses`
 * only ever touches passes of erased attendees of the event it is given, and a pass that is already gone at
 * the provider counts as deleted. With `dryRun` it only counts what is pending.
 *
 * One sweep has a time budget. When it runs out, the place where it stopped is kept (SWEEP_CURSOR_KEY) and the
 * next sweep goes on after it, wrapping round to the beginning, so that a long or failing run of passes at the
 * start cannot keep the rest, and the events after it, from ever being tried. A sweep that gets through
 * everything forgets the place.
 */
export async function sweepErasedWalletPasses(
  db: PrismaClient,
  options: { dryRun: boolean; budgetMs?: number },
  deps: ErasedWalletSweepDeps = realDeps,
): Promise<ErasedWalletSweepResult> {
  const budget = { startedAt: deps.nowMs(), ms: options.budgetMs ?? DEFAULT_BUDGET_MS };
  const events = await db.event.findMany({
    where: {
      attendees: {
        some: {
          erased_at: { not: null },
          wallet_pass: { is: PASS_ROW_STILL_AT_PROVIDER },
        },
      },
    },
    select: { id: true, wallet_template_id: true, wallet_api_key_enc: true, wallet_field_mapping: true },
    orderBy: { id: "asc" },
  });

  const result: ErasedWalletSweepResult = { pending: 0, deleted: 0, failed: 0, undecided: 0, noProvider: 0, notTried: 0 };
  const tally: Tally = { deleted: 0, failed: 0, undecided: 0, exhausted: false, last: null };
  const { sweepable, tryable } = await surveyEvents(db, events, options, deps, result);

  const before = options.dryRun ? null : await readCursor(db);
  for (const { event, provider, range } of inSweepOrder(sweepable, before)) {
    // Once the budget is gone the remaining events are not tried either.
    if (tally.exhausted) break;
    await sweepEvent({ db, provider, budget, deps, tally }, event.id, range); // NOSONAR - one event at a time on purpose, see surveyEvents
  }
  if (!options.dryRun) await keepPlace(db, tally, before);
  result.deleted = tally.deleted;
  result.failed = tally.failed;
  result.undecided = tally.undecided;
  result.notTried = tally.exhausted ? Math.max(0, tryable - tally.deleted - tally.failed - tally.undecided) : 0;
  return result;
}
