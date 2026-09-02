/**
 * One-time ops script, run manually (never wired into docker-entrypoint.sh's automatic migrate
 * chain - see this file's own module doc below for why):
 *
 *   npm run wallet:backfill-first-confirmed -w @admitto/web -- [--event-id <id>] [--dry-run]
 *
 * The production image has no npm/npx (docker-entrypoint.sh rejects both - "npm/npx are not
 * available in the production image"), so the above only works in a local/dev checkout. Against a
 * deployed instance, run the built output directly instead:
 *
 *   docker compose run --rm app node apps/web/dist/src/scripts/backfill-wallet-first-confirmed.js [--event-id <id>] [--dry-run]
 *
 * Two things, per wallet-enabled event:
 *
 * 1. Re-subscribes that event's PassCreator webhooks (subscribeWalletWebhooksBestEffort), so
 *    first_pushnotification_registered moves off the shared registration URL onto its own
 *    /first-confirmed one immediately, instead of waiting for that event's own next Event Settings
 *    save to pick up the change (event-settings-routes.ts).
 * 2. Backfills WalletPass.first_confirmed_at for already-confirmed passes issued before that
 *    column existed, from PassCreator's own firstDownloadedAt (the closest thing their API exposes
 *    to "first confirmed" - see parseFirstDownloadedAtUtc's own doc comment for why there's no
 *    better source: PassCreator has no activity-history API, only a dashboard-only "Pass Activity"
 *    log).
 *
 * Deliberately NOT part of the automatic deploy migration chain (deploy/docker-entrypoint.sh):
 * every other backfill there is a pure local-DB operation bounded by a 120s timeout, safe to block
 * app startup on. This one makes real outbound PassCreator API calls, one per already-confirmed
 * pass, through the client's own account-wide rate limiter - for an event with many attendees that
 * can run for minutes, and blocking a deploy's startup on a third-party API being reachable and
 * fast enough is worse than just not doing that. Safe to re-run: every write only fills a currently
 * NULL first_confirmed_at (webhook subscribe re-checks existing subscriptions before adding new
 * ones), so a second run after a partial failure just picks up where the first one left off.
 *
 * backfillEvent takes `db` as a parameter, not the `@admitto/db` singleton, matching every other
 * function it composes (subscribeWalletWebhooksBestEffort, applyWebhookUpdate, applyFirstConfirmedAt
 * all do the same) - only `main` below binds it to the real singleton, so
 * test/scripts/backfill-wallet-first-confirmed.test.ts can exercise backfillEvent directly against
 * a test database instead of needing to spawn this file as a subprocess.
 */
import type { PrismaClient } from "@admitto/db";
import { prisma } from "@admitto/db";
import { decryptFromString } from "@admitto/crypto";
import { PassCreatorClient, parseFirstDownloadedAtUtc } from "@admitto/wallet";
import { resolvePassCreatorBaseUrl } from "../config.js";
import { subscribeWalletWebhooksBestEffort } from "../admin/event-settings-routes.js";

export function arg(name: string, argv: readonly string[] = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

export function hasFlag(name: string, argv: readonly string[] = process.argv): boolean {
  return argv.includes(`--${name}`);
}

export async function backfillEvent(
  db: PrismaClient,
  event: { id: string; title: string; wallet_template_id: string | null; wallet_api_key_enc: string | null },
  dryRun: boolean,
): Promise<void> {
  console.log(`[${event.title}] re-subscribing webhooks...`);
  try {
    if (!dryRun) {
      await subscribeWalletWebhooksBestEffort(db, event.id, {
        wallet_enabled: true,
        wallet_template_id: event.wallet_template_id,
        wallet_api_key_enc: event.wallet_api_key_enc,
      });
    }
  } catch (err) {
    console.error(`[${event.title}] webhook re-subscribe failed (continuing to backfill anyway):`, err);
  }

  // Confirmed installed (at least one active registration, exactly how classifyPassPlatform
  // decides "not none" elsewhere - reports-routes.ts), no first_confirmed_at yet - a pass that was
  // never confirmed installed has nothing genuine to backfill (its firstDownloadedAt, if any, would
  // just be a download that never turned into a real wallet registration).
  const candidates = await db.walletPass.findMany({
    where: {
      attendee: { event_id: event.id },
      first_confirmed_at: null,
      user_provided_id: { not: null },
      OR: [{ apple_active_registrations: { gt: 0 } }, { google_active_registrations: { gt: 0 } }],
    },
    select: { id: true, user_provided_id: true },
  });
  console.log(`[${event.title}] ${candidates.length} confirmed pass(es) missing first_confirmed_at`);
  if (candidates.length === 0) return;

  let apiKey: string;
  try {
    apiKey = decryptFromString(event.wallet_api_key_enc ?? "");
  } catch (err) {
    console.error(`[${event.title}] API key decrypt failed, skipping backfill for this event:`, err);
    return;
  }
  const client = new PassCreatorClient({
    apiKey,
    templateId: event.wallet_template_id ?? "",
    baseUrl: resolvePassCreatorBaseUrl(),
  });

  let filled = 0;
  let skipped = 0;
  for (const pass of candidates) {
    try {
      // user_provided_id is filtered non-null in the query above, but Prisma's own generated type
      // for a `not: null` filter doesn't narrow the selected column - non-null asserted here since
      // the query guarantees it, not because the type system already knows.
      const status = await client.getRegistrationStatus(pass.user_provided_id as string);
      const firstConfirmedAt = status?.firstDownloadedAt ? parseFirstDownloadedAtUtc(status.firstDownloadedAt) : null;
      if (!firstConfirmedAt) {
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`[${event.title}] (dry-run) would set pass ${pass.id} first_confirmed_at=${firstConfirmedAt.toISOString()}`);
      } else {
        await db.walletPass.updateMany({
          where: { id: pass.id, first_confirmed_at: null },
          data: { first_confirmed_at: firstConfirmedAt },
        });
      }
      filled++;
    } catch (err) {
      console.error(`[${event.title}] pass ${pass.id} backfill failed:`, err);
      skipped++;
    }
  }
  console.log(`[${event.title}] ${dryRun ? "would fill" : "filled"} ${filled}, skipped ${skipped}`);
}

export async function main(): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const eventId = arg("event-id");

  const events = await prisma.event.findMany({
    where: {
      wallet_enabled: true,
      wallet_template_id: { not: null },
      wallet_api_key_enc: { not: null },
      ...(eventId ? { id: eventId } : {}),
    },
    select: { id: true, title: true, wallet_template_id: true, wallet_api_key_enc: true },
  });

  console.log(`found ${events.length} wallet-enabled event(s)${dryRun ? " (dry run - no writes)" : ""}`);
  for (const event of events) {
    await backfillEvent(prisma, event, dryRun);
  }
}

// Only run when executed directly (node ... backfill-wallet-first-confirmed.ts), not when
// test/scripts/backfill-wallet-first-confirmed.test.ts imports backfillEvent above - matches
// packages/db/src/scripts/*.ts's own split between a testable exported function and a thin
// CLI-only main(), just inline in one file since this script has no other consumer to share the
// exported function with.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (err) {
    console.error("backfill-wallet-first-confirmed failed:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
