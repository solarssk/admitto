import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  applyFirstConfirmedAt,
  applyWebhookUpdate,
  findWebhookPassTarget,
  parseAdmittoUserProvidedId,
  parseWebhookData,
  parseWebhookEnvelope,
  refreshOneWalletPassStatus,
  resolveWalletProvider,
  verifyWebhookSignature,
  WalletStatusCheckInconclusiveError,
  type PassCreatorWebhookData,
  type WalletPassProvider,
} from "@admitto/wallet";

interface WebhookCapableProvider {
  getWebhookPublicKey(): Promise<string>;
}

function hasWebhookSupport(
  provider: WalletPassProvider,
): provider is WalletPassProvider & WebhookCapableProvider {
  return typeof (provider as Partial<WebhookCapableProvider>).getWebhookPublicKey === "function";
}

/** PassCreator's webhook signing key belongs to the API key/account, not to one delivery - cached
 * per event for the life of the process rather than refetched on every delivery. A key rotation on
 * PassCreator's side would need a process restart to pick up; acceptable for a fast-follow. */
const publicKeyCache = new Map<string, string>();

/** Cached public key for eventId, fetching + caching on a cold cache. Returns null (having already
 * logged the failure) instead of throwing - the caller turns that into a 502. Split out of
 * handlePassCreatorWebhook to keep its own cognitive complexity under the SonarCloud threshold
 * (S3776). */
async function resolveCachedPublicKey(
  eventId: string,
  provider: WebhookCapableProvider,
): Promise<string | null> {
  const cached = publicKeyCache.get(eventId);
  if (cached) return cached;
  try {
    const publicKey = await provider.getWebhookPublicKey();
    publicKeyCache.set(eventId, publicKey);
    return publicKey;
  } catch (err) {
    emitSystemLog("wallet", "error", "wallet_webhook_public_key_fetch_failed", {
      eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** True if the signed payload's own userProvidedId names a different event than the URL's -
 * emits the security warning itself when it does, so the caller only needs to branch on the
 * boolean. The URL's :eventId segment must never be trusted alone (see the module doc below) -
 * the signing key belongs to the PassCreator account, not to one event, so a second Admitto event
 * on the same account would verify against this same key. Split out for the same complexity
 * reason as resolveCachedPublicKey above. */
function payloadNamesADifferentEvent(eventId: string, data: PassCreatorWebhookData): boolean {
  if (!data.userProvidedId) return false;
  const parsed = parseAdmittoUserProvidedId(data.userProvidedId);
  if (!parsed || parsed.eventId === eventId) return false;
  emitSystemLog("security", "warn", "wallet_webhook_event_mismatch", {
    eventId,
    payloadEventId: parsed.eventId,
  });
  return true;
}

/** Handles a `pass_voided` delivery: a signal that the pass's state MAY have changed, not the new
 * state - the delivery carries no validity field, and a late redelivery can arrive after a Restore
 * that already undid the void. So it re-reads the pass from the provider and lets the same
 * reconciliation as the periodic sync and manual Refresh decide (an active pass the provider now
 * reports voided or expired becomes voided/expired; nothing else changes).
 *
 * 200 = the delivery was dealt with, including "no such pass of ours" and "pass is not active, so
 * nothing to reconcile". 503 = the re-read could not be completed (provider error, or a no-match
 * that even the retry inside refreshOneWalletPassStatus could not turn into a read) - PassCreator
 * redelivers on a non-2xx (`retryEnabled` at subscribe time), and the background sync is no safety
 * net here since it skips archived events. A 503 carries no detail, like every other rejection on
 * this unauthenticated endpoint. */
async function reconcileVoidedSignal(
  c: Context,
  db: PrismaClient,
  provider: WalletPassProvider,
  eventId: string,
  data: PassCreatorWebhookData,
): Promise<Response> {
  const target = await findWebhookPassTarget(db, eventId, data);
  if (!target) {
    emitSystemLog("wallet", "info", "wallet_webhook_unmatched", { eventId });
    return c.body(null, 200);
  }
  try {
    await refreshOneWalletPassStatus(db, target, provider);
  } catch (err) {
    emitSystemLog("wallet", "warn", "wallet_webhook_reconcile_failed", {
      eventId,
      reason: err instanceof WalletStatusCheckInconclusiveError ? "inconclusive" : "provider_error",
    });
    return c.body(null, 503);
  }
  emitSystemLog("wallet", "info", "wallet_webhook_applied", { eventId });
  return c.body(null, 200);
}

async function resolveEventWebhookProvider(
  db: PrismaClient,
  eventId: string,
  injectedProvider?: WalletPassProvider,
): Promise<(WalletPassProvider & WebhookCapableProvider) | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { wallet_enabled: true, wallet_template_id: true, wallet_api_key_enc: true },
  });
  if (!event) return null;
  const provider = resolveWalletProvider(
    {
      walletEnabled: event.wallet_enabled,
      walletTemplateId: event.wallet_template_id,
      walletApiKeyEnc: event.wallet_api_key_enc,
      walletFieldMapping: null,
    },
    injectedProvider,
  );
  if (!provider || !hasWebhookSupport(provider)) return null;
  return provider;
}

/**
 * Receives PassCreator's signed webhook deliveries (registration/void events) for one event's
 * wallet template. The target URL is scoped per event at subscribe time (subscribeWebhook()), so
 * the :eventId path segment is how a delivery is matched back to the right API key/public key -
 * it is never trusted on its own; every write is still gated on a verified signature, and the
 * signed payload's own userProvidedId is cross-checked against it below.
 *
 * Every rejection before signature verification (unconfigured wallet, unknown event, malformed
 * body, bad signature) returns a bare 4xx/404/502 with no detail - this is an unauthenticated
 * public endpoint, so the response must not help a caller distinguish "wrong event id" from
 * "right event id, wallet not configured" from "right event id, bad signature".
 *
 * `isVoidedRoute` distinguishes a `pass_voided` delivery from the three registration events -
 * confirmed 2026-08-19 (developer.passcreator.com/en/webhooks/pass-hooks) that PassCreator's
 * payload carries no field naming which event fired, and a `pass_voided` delivery specifically has
 * no `voided` field at all. subscribeWalletWebhooksBestEffort (event-settings-routes.ts) points
 * `pass_voided` at its own `/voided`-suffixed target URL for exactly this reason, so arriving on
 * that route at all - not any field in the body - is the signal, handled by reconcileVoidedSignal. `isFirstConfirmedRoute` is the same
 * idea for `first_pushnotification_registered` (its own `/first-confirmed`-suffixed URL, added
 * later): a delivery there triggers applyFirstConfirmedAt in addition to the normal
 * applyWebhookUpdate, rather than instead of it - the delivery still carries real registration-
 * count data worth applying the usual way.
 */
export async function handlePassCreatorWebhook(
  c: Context,
  db: PrismaClient,
  injectedProvider?: WalletPassProvider,
  isVoidedRoute = false,
  isFirstConfirmedRoute = false,
): Promise<Response> {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.body(null, 404);
  const provider = await resolveEventWebhookProvider(db, eventId, injectedProvider);
  if (!provider) return c.body(null, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.body(null, 400);
  }
  const envelope = parseWebhookEnvelope(body);
  if (!envelope) return c.body(null, 400);

  const publicKey = await resolveCachedPublicKey(eventId, provider);
  if (!publicKey) return c.body(null, 502);

  if (!verifyWebhookSignature(envelope.signedData, envelope.signature, publicKey)) {
    emitSystemLog("security", "warn", "wallet_webhook_signature_invalid", { eventId });
    return c.body(null, 401);
  }

  const data = parseWebhookData(envelope.signedData);
  if (!data) return c.body(null, 400);

  if (payloadNamesADifferentEvent(eventId, data)) return c.body(null, 200);

  if (isVoidedRoute) return reconcileVoidedSignal(c, db, provider, eventId, data);

  // Success is otherwise silent (a bare 200) - this is the only positive signal in System Logs
  // that a delivery actually reached us, verified, and either found or missed its WalletPass row.
  // Grep System Logs for "wallet_webhook_" during live setup: signature/key/mismatch warnings mean
  // delivery arrived but was rejected before this point; neither this nor those appearing at all
  // means PassCreator isn't reaching this URL (subscription/network problem, not a signature one).
  const { matched } = await applyWebhookUpdate(db, data);
  if (isFirstConfirmedRoute) await applyFirstConfirmedAt(db, data);
  emitSystemLog("wallet", "info", matched ? "wallet_webhook_applied" : "wallet_webhook_unmatched", {
    eventId,
  });
  return c.body(null, 200);
}
