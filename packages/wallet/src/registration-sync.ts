import type { PrismaClient } from "@admitto/db";
import { resolveWalletProvider } from "./resolve-provider.js";
import type { WalletPassProvider } from "./provider.js";

/** Cap on how many passes one sync call refreshes - keeps a single tick bounded regardless of
 * how many are stale at once (the rest just wait for the next tick). */
export const WALLET_SYNC_BATCH_LIMIT = 25;
/** How long a pass's registration status is trusted before it's due for a refresh. */
export const WALLET_SYNC_STALE_MS = 30 * 60 * 1000;
/** Concurrent getRegistrationStatus calls within one event's batch - PassCreator's own rate limit
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
  user_provided_id: string | null;
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

async function syncOne(db: PrismaClient, provider: WalletPassProvider, row: CandidateRow): Promise<void> {
  const status = row.user_provided_id
    ? await provider.getRegistrationStatus(row.user_provided_id)
    : null;
  await db.walletPass.update({
    where: { attendee_id: row.attendee_id },
    data: {
      apple_active_registrations: status?.appleActiveRegistrations ?? null,
      apple_inactive_registrations: status?.appleInactiveRegistrations ?? null,
      google_active_registrations: status?.googleActiveRegistrations ?? null,
      google_inactive_registrations: status?.googleInactiveRegistrations ?? null,
      first_downloaded_at: status?.firstDownloadedAt ?? null,
      registration_checked_at: new Date(),
    },
  });
}

/**
 * Periodic best-effort refresh of each wallet pass's device-registration status straight from
 * PassCreator (GET /api/v3/pass?userProvidedId=...) - never called on a request path, only from
 * the `wallet_sync` worker job (apps/cli). Picks up passes that are active or voided (voiding
 * only flips PassCreator's own `voided` flag - it doesn't unregister the device, so a voided pass
 * can still be genuinely registered) whose `registration_checked_at` is missing or older than
 * WALLET_SYNC_STALE_MS, oldest-first, capped at WALLET_SYNC_BATCH_LIMIT per call so one tick can't
 * run unbounded - the rest simply wait for the next tick. Groups candidates by event so each
 * event's provider (and its one API-key decrypt) is resolved once, not once per pass. A
 * getRegistrationStatus failure for one pass (provider outage, revoked key, ...) is caught and
 * counted as `failed` rather than aborting the whole batch - the row's own stale data is left
 * alone and retried on a later tick.
 */
export async function runWalletRegistrationSync(
  db: PrismaClient,
  nowMs = Date.now(),
): Promise<WalletRegistrationSyncResult> {
  const staleBefore = new Date(nowMs - WALLET_SYNC_STALE_MS);
  const candidates: CandidateRow[] = await db.walletPass.findMany({
    where: {
      status: { in: ["active", "voided"] },
      provider_pass_id: { not: null },
      user_provided_id: { not: null },
      OR: [{ registration_checked_at: null }, { registration_checked_at: { lt: staleBefore } }],
    },
    select: {
      attendee_id: true,
      user_provided_id: true,
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
    orderBy: { registration_checked_at: { sort: "asc", nulls: "first" } },
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
      continue;
    }

    for (const batch of chunk(rows, SYNC_CONCURRENCY)) {
      const settled = await Promise.allSettled(batch.map((row) => syncOne(db, provider, row)));
      for (const outcome of settled) {
        result.checked += 1;
        if (outcome.status === "fulfilled") result.updated += 1;
        else result.failed += 1;
      }
    }
  }

  return result;
}
