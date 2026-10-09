import type { Prisma, PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { deleteErasedWalletPasses, parseWalletFieldMapping } from "@admitto/tickets";
import { resolveConfiguredWalletProvider, type WalletPassProvider } from "@admitto/wallet";

/** How long one sweep may spend at the provider. The worker's retention job holds up the next drain while it runs. */
const DEFAULT_BUDGET_MS = 60_000;
const PAGE_SIZE = 100;

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

type EventToSweep = {
  id: string;
  wallet_template_id: string | null;
  wallet_api_key_enc: string | null;
  wallet_field_mapping: unknown;
};

/** What the sweep needs from outside, so a test can stand in for the provider and the clock. */
export type ErasedWalletSweepDeps = {
  resolveProvider: (event: EventToSweep) => WalletPassProvider | null;
  deletePasses: typeof deleteErasedWalletPasses;
  nowMs: () => number;
};

const realDeps: ErasedWalletSweepDeps = {
  // Credentials alone decide whether a provider exists; the event's wallet switch only governs issuing new passes.
  resolveProvider: (event) =>
    resolveConfiguredWalletProvider({
      walletTemplateId: event.wallet_template_id,
      walletApiKeyEnc: event.wallet_api_key_enc,
      walletFieldMapping: parseWalletFieldMapping(event.wallet_field_mapping),
    }),
  deletePasses: deleteErasedWalletPasses,
  nowMs: () => Date.now(),
};

/** The same question the erase API asks after an erasure: a pass with a provider id, not yet removed, of an erased attendee. */
function passToDelete(eventId: string): Prisma.WalletPassWhereInput {
  return {
    provider_pass_id: { not: null },
    provider_removed_at: null,
    attendee: { event_id: eventId, erased_at: { not: null } },
  };
}

type Tally = { deleted: number; failed: number; exhausted: boolean };

/**
 * Deletes the pending passes of one event, a page at a time (by attendee id, so a page of passes that stay
 * cannot be read again), until none are left or the budget is gone. Failures are logged by attendee id,
 * which is a pseudonym once the person is erased, never by name or address.
 */
async function sweepEvent(
  db: PrismaClient,
  eventId: string,
  provider: WalletPassProvider,
  budget: { startedAt: number; ms: number },
  deps: ErasedWalletSweepDeps,
  tally: Tally,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const remainingMs = budget.ms - (deps.nowMs() - budget.startedAt);
    if (remainingMs <= 0) {
      tally.exhausted = true;
      return;
    }
    const page = await db.walletPass.findMany({
      where: { ...passToDelete(eventId), ...(cursor ? { attendee_id: { gt: cursor } } : {}) },
      select: { attendee_id: true },
      orderBy: { attendee_id: "asc" },
      take: PAGE_SIZE,
    });
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
    if (run.notTried > 0) {
      tally.exhausted = true;
      return;
    }
    if (page.length < PAGE_SIZE) return;
    cursor = attendeeIds[attendeeIds.length - 1];
  }
}

/**
 * Retries, at the wallet provider, the deletion of passes of attendees whose personal data was erased: the
 * erase API deletes them right after the commit, but a provider that was down, an event whose credentials were
 * missing then, or a request that ran out of time leaves the pass marked "still to delete", and nothing else
 * retried it. Runs from the worker's retention job and `admitto retention run`. `deleteErasedWalletPasses`
 * only ever touches passes of erased attendees of the event it is given, and a pass that is already gone at
 * the provider counts as deleted. With `dryRun` it only counts what is pending.
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
  const tally: Tally = { deleted: 0, failed: 0, exhausted: false };
  let tryable = 0;
  for (const event of events) {
    const pending = await db.walletPass.count({ where: passToDelete(event.id) }); // NOSONAR - one event at a time on purpose: the events share one time budget and the provider must not be burst
    result.pending += pending;
    if (options.dryRun || pending === 0) continue;
    const provider = deps.resolveProvider(event);
    if (!provider) {
      result.noProvider += pending;
      continue;
    }
    tryable += pending;
    // Once the budget is gone the remaining events are not tried either: each sweepEvent stops at its first look.
    await sweepEvent(db, event.id, provider, budget, deps, tally); // NOSONAR - one event at a time on purpose, see above
  }
  result.deleted = tally.deleted;
  result.failed = tally.failed;
  result.notTried = tally.exhausted ? Math.max(0, tryable - tally.deleted - tally.failed) : 0;
  return result;
}
