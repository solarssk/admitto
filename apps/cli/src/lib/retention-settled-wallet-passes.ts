import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  SETTLED_RECHECK_HORIZON_MS,
  recheckSettledWalletPasses,
  settledUntrackedPassRow,
  type RecheckSettledWalletPassesResult,
} from "@admitto/tickets";
import type { WalletPassProvider } from "@admitto/wallet";
import type { EventWalletCredentials } from "./retention-erased-wallet-passes.js";
import { inSweepOrder, readCursor, writeCursor, type Cursor } from "./retention-sweep-cursor.js";

/** Where the last second look that was cut short stopped (a SystemSettings row), so that the next one goes on from there. */
export const RECHECK_CURSOR_KEY = "retention.settled_wallet_recheck_cursor";

/** What the second look needs from outside, so a test can stand in for the provider and the clock. */
export type SettledRecheckDeps = {
  resolveProvider: (event: EventWalletCredentials & { id: string }) => WalletPassProvider | null;
  recheck: typeof recheckSettledWalletPasses;
  nowMs: () => number;
};

/** What one event's second look has to tell in its lines, with the event's id only. */
function reportRecheck(eventId: string, run: RecheckSettledWalletPassesResult): void {
  if (run.found > 0) emitSystemLog("wallet", "warn", "wallet_pass_found_after_settling", { eventId, deleted: run.found });
  if (run.failed > 0) emitSystemLog("wallet", "warn", "wallet_pass_recheck_failed", { eventId, failed: run.failed });
  // The rows after the place where it stopped are asked about by the next run, so this says only that one run did not get through them all.
  if (run.incomplete) emitSystemLog("wallet", "warn", "wallet_pass_recheck_incomplete", { eventId });
}

/** How one run of the second look went: the last row it asked about (null while it has asked about none) and whether it
 * was cut short, by the time or by a full page. */
type RecheckWalk = { last: Cursor | null; cutShort: boolean };

/** Keeps the place where a run that was cut short stopped, or forgets it when a run got through everything. A run that
 * was cut short before it asked about anything leaves the place as it was. */
async function keepRecheckPlace(db: PrismaClient, walk: RecheckWalk, before: Cursor | null): Promise<void> {
  if (walk.cutShort) {
    if (walk.last) await writeCursor(db, RECHECK_CURSOR_KEY, walk.last);
  } else if (before) {
    await writeCursor(db, RECHECK_CURSOR_KEY, null);
  }
}

/**
 * The second look of the daily sweep: for every event that has unrecorded passes of erased attendees which were marked
 * removed within {@link SETTLED_RECHECK_HORIZON_MS}, asks the provider again for the ids reserved for them and deletes
 * a pass that has turned up since (recheckSettledWalletPasses). Best effort and silent when all is well: one warning per
 * event and run when a pass was found (the sign that an answer of "none" came too early, with the event's id only), one
 * when the provider could not answer, and one when the run was cut short. An event without credentials the sweep can use
 * is skipped (the sweep over pending passes already reports those). `budgetMs` is what is left of the sweep's time.
 *
 * A run that is cut short (the time ran out, or an event had more rows than one page) keeps the place where it stopped
 * (RECHECK_CURSOR_KEY) and the next run goes on after it, wrapping round to the beginning, the way the sweep over pending
 * passes does: otherwise the same first rows would be asked about every day while the rest of the week passed. A run that
 * gets through everything forgets the place.
 */
export async function recheckSettledWalletPassesOfEvents(
  db: PrismaClient,
  options: { budgetMs: number },
  deps: SettledRecheckDeps,
): Promise<void> {
  if (options.budgetMs <= 0) return;
  const startedAt = deps.nowMs();
  const events = await db.event.findMany({
    where: {
      attendees: {
        some: {
          erased_at: { not: null },
          wallet_pass: { is: settledUntrackedPassRow(new Date(startedAt - SETTLED_RECHECK_HORIZON_MS)) },
        },
      },
    },
    select: { id: true, wallet_template_id: true, wallet_api_key_enc: true, wallet_field_mapping: true },
    orderBy: { id: "asc" },
  });
  const before = await readCursor(db, RECHECK_CURSOR_KEY);
  const walk: RecheckWalk = { last: null, cutShort: false };
  for (const { event, range } of inSweepOrder(events.map((event) => ({ event })), before)) {
    const remainingMs = options.budgetMs - (deps.nowMs() - startedAt);
    if (remainingMs <= 0) {
      walk.cutShort = true;
      break;
    }
    const provider = deps.resolveProvider(event);
    if (!provider) continue;
    const run = await deps.recheck(db, event.id, provider, { budgetMs: remainingMs, ...range }); // NOSONAR - one event at a time on purpose: the events share one time budget and the provider must not be burst
    if (run.last !== null) walk.last = { eventId: event.id, attendeeId: run.last };
    reportRecheck(event.id, run);
    if (run.incomplete) {
      walk.cutShort = true;
      break;
    }
  }
  await keepRecheckPlace(db, walk, before);
}
