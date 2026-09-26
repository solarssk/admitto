import type { PrismaClient } from "@admitto/db";
import { applyProviderSnapshotToWalletPass } from "./apply-provider-snapshot.js";
import { resolveWalletProvider } from "./resolve-provider.js";
import type { WalletPassProvider } from "./provider.js";

/** Cap on how many passes one sync call refreshes - keeps a single tick bounded regardless of
 * how many are stale at once (the rest just wait for the next tick). */
export const WALLET_SYNC_BATCH_LIMIT = 25;
/** How long a pass's registration status is trusted before it's due for a refresh. */
export const WALLET_SYNC_STALE_MS = 30 * 60 * 1000;
/** Concurrent getPassSnapshot calls within one event's batch - PassCreator's own rate limit
 * is 600 req/min (ADR 0041 §3); this stays well under it without needing its own backoff logic
 * (PassCreatorClient.requestRaw already retries 429s per call). */
const SYNC_CONCURRENCY = 3;

export type WalletRegistrationSyncResult = {
  checked: number;
  updated: number;
  skippedNoProvider: number;
  failed: number;
};

type CandidateRow = {
  attendee_id: string;
  provider_pass_id: string | null;
  user_provided_id: string | null;
  status: string;
  provider_commanded_at: Date | null;
  provider_removed_at: Date | null;
  attendee: {
    event: {
      id: string;
      wallet_enabled: boolean;
      wallet_template_id: string | null;
      wallet_api_key_enc: string | null;
    };
  };
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Always stamps registration_sync_attempted_at, even when the provider found no match or the
 * call itself failed - otherwise a persistently-unresolvable row (deleted at the provider,
 * revoked key, provider outage) never advances past this batch's oldest-first ordering and
 * starves every other candidate, in this event and every other, from ever being re-checked
 * again. registration_checked_at and every registration-count column only advance on a genuine
 * *found* read - a provider "no match" result is written identically to a hard failure (nothing
 * touched but registration_sync_attempted_at), not as a confirmed zero.
 *
 * This distinction matters because PassCreator's own lookup (searchByUserProvidedId,
 * passcreator-client.ts) is a *search*, not a get-by-ID: a pass that has genuinely vanished at the
 * provider (deleted directly there, bypassing Admitto, or pruned by the provider's own data-
 * retention rules while the rest of the account is still fully reachable) makes that search
 * return a normal, non-error empty result - getPassSnapshot resolves to `null`, exactly the
 * same shape as "not yet installed anywhere". Writing that as all-null registration counts would
 * silently overwrite the historical fact that this pass really was confirmed installed at some
 * point (2026-09-03 incident/investigation) - registration_checked_at would even advance,
 * making the row look freshly, successfully synced. Checking `snapshot` (not `err`) for the write
 * decision below fixes this uniformly: both "no match" and "provider error" already resolve
 * `snapshot` to null, so both take the same preserve-everything-but-attempted_at path without
 * needing a third branch. Still rejects after a provider failure so the caller's Promise.allSettled
 * counts it as `failed`, including when a provider rejects with a non-Error value.
 *
 * A *found* snapshot goes through applyProviderSnapshotToWalletPass: the registration counts as
 * before, plus the one lifecycle transition an observation may cause (an active pass the provider
 * reports voided or expired). That write is conditioned on the row exactly as this tick read it
 * (identity and lifecycle state), so a pass deleted and issued again, or voided/restored, while the
 * provider call was in flight is skipped quietly - its own next tick picks it up - instead of
 * getting the OLD read written onto it. The not-found/failure write below stays conditioned on
 * identity only: it changes nothing but the scheduling marker. */
async function syncOne(
  db: PrismaClient,
  provider: WalletPassProvider,
  row: CandidateRow,
  providerTimeZone: string | null,
): Promise<void> {
  let snapshot: Awaited<ReturnType<WalletPassProvider["getPassSnapshot"]>> | null = null;
  let failure: unknown;
  let registrationStatusFailed = false;
  if (row.user_provided_id && row.provider_pass_id) {
    try {
      snapshot = await provider.getPassSnapshot({
        providerPassId: row.provider_pass_id,
        userProvidedId: row.user_provided_id,
      });
    } catch (error_) {
      registrationStatusFailed = true;
      failure = error_;
    }
  }
  if (snapshot && row.user_provided_id && row.provider_pass_id) {
    await applyProviderSnapshotToWalletPass(
      db,
      {
        attendeeId: row.attendee_id,
        providerPassId: row.provider_pass_id,
        userProvidedId: row.user_provided_id,
        status: row.status,
        provider_commanded_at: row.provider_commanded_at,
        provider_removed_at: row.provider_removed_at,
      },
      snapshot,
      { policy: provider.consistencyPolicy, providerTimeZone },
    );
  } else {
    await db.walletPass.updateMany({
      where: {
        attendee_id: row.attendee_id,
        provider_pass_id: row.provider_pass_id,
        user_provided_id: row.user_provided_id,
      },
      data: { registration_sync_attempted_at: new Date() },
    });
  }
  if (registrationStatusFailed) {
    throw failure instanceof Error ? failure : new Error("Wallet registration status lookup failed");
  }
}

/** Resolves one event's provider and syncs its rows, mutating `result` in place - split out of
 * runWalletRegistrationSync to keep its own cognitive complexity under the SonarCloud threshold
 * (S3776). Rows for an event with no resolvable provider still get registration_sync_attempted_at
 * bumped (same starvation reasoning as syncOne's own failure path above) instead of being
 * silently left null forever - registration_checked_at is untouched, since no read actually
 * happened. */
async function syncEventBucket(
  db: PrismaClient,
  event: CandidateRow["attendee"]["event"],
  rows: CandidateRow[],
  result: WalletRegistrationSyncResult,
): Promise<void> {
  const provider = resolveWalletProvider({
    walletEnabled: event.wallet_enabled,
    walletTemplateId: event.wallet_template_id,
    walletApiKeyEnc: event.wallet_api_key_enc,
    // Field mapping only shapes createPass/updatePass's outbound data - irrelevant to a
    // read-only registration-status query.
    walletFieldMapping: null,
  });
  if (!provider) {
    result.skippedNoProvider += rows.length;
    await db.walletPass.updateMany({
      where: { attendee_id: { in: rows.map((row) => row.attendee_id) } },
      data: { registration_sync_attempted_at: new Date() },
    });
    return;
  }

  // The event's own PassCreator time zone setting does not exist yet, so a provider expiration
  // written as naive wall-clock digits is never interpreted here: a voided-or-expired report reads
  // as `voided` (see reconcileWalletPassLifecycle).
  const providerTimeZone = null;

  for (const batch of chunk(rows, SYNC_CONCURRENCY)) {
    const settled = await Promise.allSettled(batch.map((row) => syncOne(db, provider, row, providerTimeZone)));
    for (const outcome of settled) {
      result.checked += 1;
      if (outcome.status === "fulfilled") result.updated += 1;
      else result.failed += 1;
    }
  }
}

/**
 * Periodic best-effort refresh of each wallet pass's device-registration status straight from
 * PassCreator (GET /api/v3/pass?userProvidedId=...) - never called on a request path, only from
 * the `wallet_sync` worker job (apps/cli). Picks up active passes of events that are not archived
 * whose `registration_sync_attempted_at` is missing or older than WALLET_SYNC_STALE_MS,
 * oldest-first, capped at WALLET_SYNC_BATCH_LIMIT per call so one tick can't run unbounded - the
 * rest simply wait for the next tick. The same read is how Admitto notices that the provider has
 * voided or expired a pass on its own (see applyProviderSnapshotToWalletPass). Groups candidates by event so
 * each event's provider (and its one API-key decrypt) is resolved once, not once per pass. A
 * getPassSnapshot failure for one pass (provider outage, revoked key, ...) is caught and
 * counted as `failed` rather than aborting the whole batch - its registration counts are left
 * alone, but registration_sync_attempted_at is still bumped so it backs off for
 * WALLET_SYNC_STALE_MS instead of permanently monopolizing every future batch's oldest-first
 * selection (same reasoning applies to an entire event with no resolvable provider).
 * registration_checked_at, read separately by the admin UI, only advances on an actual successful
 * read - it is never used for this scheduling decision, so a failing row's UI-facing "last known
 * good" timestamp doesn't silently drift forward while it keeps failing.
 */
export async function runWalletRegistrationSync(
  db: PrismaClient,
  nowMs = Date.now(),
): Promise<WalletRegistrationSyncResult> {
  const staleBefore = new Date(nowMs - WALLET_SYNC_STALE_MS);
  const candidates: CandidateRow[] = await db.walletPass.findMany({
    where: {
      // Only an active pass is polled: voided and expired are Admitto's own recorded states and
      // nothing the provider reports can change them, so re-reading one is wasted API budget (and
      // its last registration counts stay frozen at the read that ended its active life).
      status: "active",
      provider_pass_id: { not: null },
      user_provided_id: { not: null },
      // Not just a filter: WalletPass_registration_sync_pending_idx is a partial index whose
      // predicate includes `provider_removed_at IS NULL`, and Postgres only uses a partial index
      // for a query whose own WHERE implies that predicate.
      provider_removed_at: null,
      // An archived event is finished business: the background poll leaves it alone (a manual
      // Refresh status still works there).
      attendee: { event: { archived_at: null } },
      OR: [
        { registration_sync_attempted_at: null },
        { registration_sync_attempted_at: { lt: staleBefore } },
      ],
    },
    select: {
      attendee_id: true,
      provider_pass_id: true,
      user_provided_id: true,
      status: true,
      provider_commanded_at: true,
      provider_removed_at: true,
      attendee: {
        select: {
          event: {
            select: {
              id: true,
              wallet_enabled: true,
              wallet_template_id: true,
              wallet_api_key_enc: true,
            },
          },
        },
      },
    },
    take: WALLET_SYNC_BATCH_LIMIT,
    orderBy: { registration_sync_attempted_at: { sort: "asc", nulls: "first" } },
  });

  const result: WalletRegistrationSyncResult = {
    checked: 0,
    updated: 0,
    skippedNoProvider: 0,
    failed: 0,
  };
  if (candidates.length === 0) return result;

  const byEvent = new Map<string, { event: CandidateRow["attendee"]["event"]; rows: CandidateRow[] }>();
  for (const row of candidates) {
    const event = row.attendee.event;
    const bucket = byEvent.get(event.id);
    if (bucket) bucket.rows.push(row);
    else byEvent.set(event.id, { event, rows: [row] });
  }

  for (const { event, rows } of byEvent.values()) {
    await syncEventBucket(db, event, rows, result);
  }

  return result;
}
