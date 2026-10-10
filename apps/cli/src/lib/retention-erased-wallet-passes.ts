import type { Prisma, PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { deleteErasedWalletPasses, parseWalletFieldMapping } from "@admitto/tickets";
import { resolveConfiguredWalletProvider, type WalletPassProvider } from "@admitto/wallet";

/** How long one sweep may spend at the provider. The worker's retention job holds up the next drain while it runs. */
const DEFAULT_BUDGET_MS = 60_000;
const PAGE_SIZE = 100;
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
  /** Their event has no wallet credentials the sweep can use, so nothing was tried. */
  noProvider: number;
  /** Not tried because the time budget ran out. */
  notTried: number;
};

/** Passes of erased attendees that are still at the provider after a sweep: the ones that failed, could not be tried, or had no credentials. */
export function erasedWalletPassesLeft(result: ErasedWalletSweepResult): number {
  return result.failed + result.noProvider + result.notTried;
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
 * The same question the erase API asks after an erasure: a pass with a provider id, not yet removed, of an erased
 * attendee (of the given ones, when `attendeeIds` is set).
 */
export function passToDelete(eventId: string, attendeeIds?: readonly string[]): Prisma.WalletPassWhereInput {
  return {
    provider_pass_id: { not: null },
    provider_removed_at: null,
    attendee: { event_id: eventId, erased_at: { not: null } },
    ...(attendeeIds ? { attendee_id: { in: [...attendeeIds] } } : {}),
  };
}

type Tally = { deleted: number; failed: number; exhausted: boolean; last: Cursor | null };

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

/**
 * Deletes the pending passes of one event in `range`, a page at a time (by attendee id, so a page of passes that
 * stay cannot be read again), until none are left or the budget is gone. Failures are logged by attendee id,
 * which is a pseudonym once the person is erased, never by name or address. The last pass tried goes into
 * `tally.last`, which is what lets the next sweep go on after it.
 */
async function sweepEvent(
  db: PrismaClient,
  eventId: string,
  provider: WalletPassProvider,
  budget: { startedAt: number; ms: number },
  deps: ErasedWalletSweepDeps,
  tally: Tally,
  range: Range = {},
): Promise<void> {
  let cursor = range.after;
  for (;;) {
    const remainingMs = budget.ms - (deps.nowMs() - budget.startedAt);
    if (remainingMs <= 0) {
      tally.exhausted = true;
      return;
    }
    const page = await db.walletPass.findMany({
      where: {
        ...passToDelete(eventId),
        ...(cursor || range.upTo ? { attendee_id: { ...(cursor ? { gt: cursor } : {}), ...(range.upTo ? { lte: range.upTo } : {}) } } : {}),
      },
      select: { attendee_id: true },
      orderBy: { attendee_id: "asc" },
      take: PAGE_SIZE,
    });
    if (page.length === 0) return;
    const attendeeIds = page.map((pass) => pass.attendee_id);
    const run = await deps.deletePasses(db, eventId, attendeeIds, provider, { budgetMs: remainingMs });
    tally.deleted += run.deleted;
    tally.failed += run.failedAttendeeIds.length;
    for (const attendeeId of run.failedAttendeeIds) {
      emitSystemLog("wallet", "error", "wallet_pass_erasure_delete_failed", {
        eventId,
        attendeeId,
        codes: run.failureCodes.join(","),
      });
    }
    // deleteErasedWalletPasses goes by attendee id too, so what it did not try is the end of the page.
    const tried = attendeeIds.length - run.notTried;
    if (tried > 0) tally.last = { eventId, attendeeId: attendeeIds[tried - 1]! };
    if (run.notTried > 0) {
      tally.exhausted = true;
      return;
    }
    if (page.length < PAGE_SIZE) return;
    cursor = attendeeIds[attendeeIds.length - 1];
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
          wallet_pass: { is: { provider_pass_id: { not: null }, provider_removed_at: null } },
        },
      },
    },
    select: { id: true, wallet_template_id: true, wallet_api_key_enc: true, wallet_field_mapping: true },
    orderBy: { id: "asc" },
  });

  const result: ErasedWalletSweepResult = { pending: 0, deleted: 0, failed: 0, noProvider: 0, notTried: 0 };
  const tally: Tally = { deleted: 0, failed: 0, exhausted: false, last: null };
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

  const cursor = options.dryRun ? null : await readCursor(db);
  for (const { event, provider, range } of inSweepOrder(sweepable, cursor)) {
    // Once the budget is gone the remaining events are not tried either.
    if (tally.exhausted) break;
    await sweepEvent(db, event.id, provider, budget, deps, tally, range); // NOSONAR - one event at a time on purpose, see above
  }
  if (!options.dryRun) {
    if (tally.exhausted) {
      if (tally.last) await writeCursor(db, tally.last);
    } else if (cursor) {
      await writeCursor(db, null);
    }
  }
  result.deleted = tally.deleted;
  result.failed = tally.failed;
  result.notTried = tally.exhausted ? Math.max(0, tryable - tally.deleted - tally.failed) : 0;
  return result;
}
