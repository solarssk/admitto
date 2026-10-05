import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import { logRateLimitExceeded } from "@admitto/auth";
import { emitSystemLog } from "@admitto/shared/system-log";
import {
  applyFirstConfirmedAt,
  applyWebhookUpdate,
  findWebhookPassTarget,
  parseAdmittoUserProvidedId,
  parseWebhookData,
  parseWebhookEnvelope,
  refreshOneWalletPassStatus,
  resolveConfiguredWalletProvider,
  verifyWebhookSignature,
  WalletStatusCheckInconclusiveError,
  type PassCreatorWebhookData,
  type WalletPassProvider,
  type WalletStatusRefreshOutcome,
  type WebhookPassTarget,
} from "@admitto/wallet";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import { INLINE_RATE_LIMITS } from "./rate-limit/policies.js";
import type { RateLimitStore } from "./rate-limit/types.js";

interface WebhookCapableProvider {
  getWebhookPublicKey(): Promise<string>;
}

function hasWebhookSupport(
  provider: WalletPassProvider,
): provider is WalletPassProvider & WebhookCapableProvider {
  return typeof (provider as Partial<WebhookCapableProvider>).getWebhookPublicKey === "function";
}

/** PassCreator's webhook signing key belongs to the API key/account, not to one delivery - cached
 * per event rather than refetched on every delivery. The entry also remembers a fingerprint of the
 * event's stored credentials, so saving a different PassCreator API key makes the next delivery
 * fetch (and verify against) the new account's key instead of the old one until a restart. */
const publicKeyCache = new Map<string, { publicKey: string; credentialFingerprint: string }>();

/** Cached public key for eventId, fetching + caching on a cold cache or after the event's
 * credentials changed. Returns null (having already logged the failure) instead of throwing - the
 * caller turns that into a 502. Split out of handlePassCreatorWebhook to keep its own cognitive
 * complexity under the SonarCloud threshold (S3776). */
async function resolveCachedPublicKey(
  eventId: string,
  credentialFingerprint: string,
  provider: WebhookCapableProvider,
): Promise<string | null> {
  const cached = publicKeyCache.get(eventId);
  if (cached?.credentialFingerprint === credentialFingerprint) return cached.publicKey;
  try {
    const publicKey = await provider.getWebhookPublicKey();
    publicKeyCache.set(eventId, { publicKey, credentialFingerprint });
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
 * reports voided or expired becomes voided/expired; nothing else changes). `target` is already
 * resolved by the caller - see its own removed-row guard in handlePassCreatorWebhook, which both
 * routes share.
 *
 * 200 = the delivery was dealt with, including "pass is not active, so nothing to reconcile". 503
 * = the re-read could not be completed (provider error, or a no-match that even the retry inside
 * refreshOneWalletPassStatus could not turn into a read) - PassCreator redelivers on a non-2xx
 * (`retryEnabled` at subscribe time), and the background sync is no safety net here since it skips
 * archived events. A 503 carries no detail, like every other rejection on this unauthenticated
 * endpoint. */
async function reconcileVoidedSignal(
  c: Context,
  db: PrismaClient,
  provider: WalletPassProvider,
  eventId: string,
  target: WebhookPassTarget & { providerRemovedAt: null },
): Promise<Response> {
  let outcome: WalletStatusRefreshOutcome;
  try {
    outcome = await refreshOneWalletPassStatus(db, target, provider);
  } catch (err) {
    emitSystemLog("wallet", "warn", "wallet_webhook_reconcile_failed", {
      eventId,
      reason: err instanceof WalletStatusCheckInconclusiveError ? "inconclusive" : "provider_error",
    });
    return c.body(null, 503);
  }
  if (outcome === "suppressed") {
    // The provider genuinely reports this pass voided, but the read fell inside the consistency
    // window right after Admitto's own last Void/Restore - it might be a stale search-index read
    // of the state from before that command, or a second, real void that happens to land in the
    // same window; the two look identical from timestamps alone. 200 here would tell PassCreator
    // the delivery is fully handled and stop it from redelivering, silently losing a real void on
    // an archived or switched-off event (no periodic sync there to ever revisit it) - so this is
    // answered the same as an inconclusive read (Codex review, 2026-09-27).
    emitSystemLog("wallet", "info", "wallet_webhook_reconcile_suppressed", { eventId });
    return c.body(null, 503);
  }
  emitSystemLog("wallet", "info", "wallet_webhook_applied", { eventId });
  return c.body(null, 200);
}

async function resolveEventWebhookProvider(
  db: PrismaClient,
  eventId: string,
  injectedProvider?: WalletPassProvider,
): Promise<{ provider: WalletPassProvider & WebhookCapableProvider; credentialFingerprint: string } | null> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { wallet_template_id: true, wallet_api_key_enc: true },
  });
  if (!event) return null;
  // The event's credentials alone, not the wallet master switch: switching Wallet off stops new
  // passes being issued but does not unsubscribe the PassCreator hooks, so deliveries for the
  // passes that already exist keep arriving and still need their signature key and a provider to
  // re-read the pass with (a void reported while the switch was off must not be dropped).
  const provider = resolveConfiguredWalletProvider(
    {
      walletTemplateId: event.wallet_template_id,
      walletApiKeyEnc: event.wallet_api_key_enc,
      walletFieldMapping: null,
    },
    injectedProvider,
  );
  if (!provider || !hasWebhookSupport(provider)) return null;
  // The stored value is ciphertext (never the API key) and stays in process memory only. It
  // changes whenever the key is re-saved (a fresh IV per encryption), which is exactly when the
  // cached signing key may be stale, so it is compared as is instead of being hashed.
  return { provider, credentialFingerprint: event.wallet_api_key_enc ?? "" };
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
 *
 * A delivery for a pass Admitto has removed from the provider (`provider_removed_at` set, PR 3's
 * "Remove from provider") is acked 200 here, before any provider call, reconciliation or write
 * of any kind - not just for `pass_voided`, but for a plain registration delivery too. Nothing
 * provider-facing may touch a removed row, and its frozen last-known snapshot must stay frozen; a
 * late redelivery racing the removal itself is exactly the case this guards.
 */
export async function handlePassCreatorWebhook(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  injectedProvider?: WalletPassProvider,
  isVoidedRoute = false,
  isFirstConfirmedRoute = false,
): Promise<Response> {
  const eventId = c.req.param("eventId");
  if (!eventId) return c.body(null, 404);
  const resolved = await resolveEventWebhookProvider(db, eventId, injectedProvider);
  if (!resolved) return c.body(null, 404);
  const { provider, credentialFingerprint } = resolved;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.body(null, 400);
  }
  const envelope = parseWebhookEnvelope(body);
  if (!envelope) return c.body(null, 400);

  const publicKey = await resolveCachedPublicKey(eventId, credentialFingerprint, provider);
  if (!publicKey) return c.body(null, 502);

  if (!verifyWebhookSignature(envelope.signedData, envelope.signature, publicKey)) {
    emitSystemLog("security", "warn", "wallet_webhook_signature_invalid", { eventId });
    return c.body(null, 401);
  }

  const data = parseWebhookData(envelope.signedData);
  if (!data) return c.body(null, 400);

  if (payloadNamesADifferentEvent(eventId, data)) return c.body(null, 200);

  // Per-event ceiling, counted only for deliveries that verified AND name this event: the :eventId
  // segment is public and unauthenticated, and accounts share one signing key across events, so a
  // replayed payload signed for another event must not spend this event's allowance either.
  const { windowMs, max } = INLINE_RATE_LIMITS["wallet:webhook-event"];
  const budget = await rateLimitStore.hit(`wallet:webhook:event:${eventId}`, windowMs, max);
  if (!budget.allowed) {
    logRateLimitExceeded({ scope: "wallet_webhook", ip: resolveClientIp(c), keyHint: "event" });
    return c.body(null, 429);
  }

  const target = await findWebhookPassTarget(db, eventId, data);
  if (target?.providerRemovedAt) {
    emitSystemLog("wallet", "info", "wallet_webhook_removed_skipped", { eventId });
    return c.body(null, 200);
  }

  if (isVoidedRoute) {
    if (!target) {
      emitSystemLog("wallet", "info", "wallet_webhook_unmatched", { eventId });
      return c.body(null, 200);
    }
    return reconcileVoidedSignal(c, db, provider, eventId, target);
  }

  // Success is otherwise silent (a bare 200) - this is the only positive signal in System Logs
  // that a delivery actually reached us, verified, and either found or missed its WalletPass row.
  // Grep System Logs for "wallet_webhook_" during live setup: signature/key/mismatch warnings mean
  // delivery arrived but was rejected before this point; neither this nor those appearing at all
  // means PassCreator isn't reaching this URL (subscription/network problem, not a signature one).
  const { matched } = await applyWebhookUpdate(db, eventId, data);
  if (isFirstConfirmedRoute) await applyFirstConfirmedAt(db, eventId, data);
  emitSystemLog("wallet", "info", matched ? "wallet_webhook_applied" : "wallet_webhook_unmatched", {
    eventId,
  });
  return c.body(null, 200);
}
