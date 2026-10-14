import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { SETTLED_RECHECK_HORIZON_MS, recheckSettledWalletPasses, settledUntrackedPassRow } from "@admitto/tickets";
import type { WalletPassProvider } from "@admitto/wallet";
import type { EventWalletCredentials } from "./retention-erased-wallet-passes.js";

/** What the second look needs from outside, so a test can stand in for the provider and the clock. */
export type SettledRecheckDeps = {
  resolveProvider: (event: EventWalletCredentials & { id: string }) => WalletPassProvider | null;
  recheck: typeof recheckSettledWalletPasses;
  nowMs: () => number;
};

/**
 * The second look of the daily sweep: for every event that has unrecorded passes of erased attendees which were marked
 * removed within {@link SETTLED_RECHECK_HORIZON_MS}, asks the provider again for the ids reserved for them and deletes
 * a pass that has turned up since (recheckSettledWalletPasses). Best effort and silent when all is well: one warning per
 * event and run when a pass was found (the sign that an answer of "none" came too early, with the event's id only), and
 * one when the provider could not answer. An event without credentials the sweep can use is skipped (the sweep over
 * pending passes already reports those). `budgetMs` is what is left of the sweep's time.
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
  for (const event of events) {
    const remainingMs = options.budgetMs - (deps.nowMs() - startedAt);
    if (remainingMs <= 0) return;
    const provider = deps.resolveProvider(event);
    if (!provider) continue;
    const run = await deps.recheck(db, event.id, provider, { budgetMs: remainingMs }); // NOSONAR - one event at a time on purpose: the events share one time budget and the provider must not be burst
    if (run.found > 0) emitSystemLog("wallet", "warn", "wallet_pass_found_after_settling", { eventId: event.id, deleted: run.found });
    if (run.failed > 0) emitSystemLog("wallet", "warn", "wallet_pass_recheck_failed", { eventId: event.id, failed: run.failed });
  }
}
