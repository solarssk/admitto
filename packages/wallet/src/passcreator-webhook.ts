import { createVerify } from "node:crypto";
import { Prisma } from "@admitto/db";
import type { PrismaClient } from "@admitto/db";

/**
 * Outer envelope PassCreator posts to a subscribed webhook when `signPayload: true` was set at
 * subscribe time (developer.passcreator.com/en/signatures/verify-a-signature). `signedData` is
 * signed as-is (the exact string bytes, not a re-serialization of parsed JSON) - verify it BEFORE
 * calling JSON.parse on it, and never trust the parsed contents until verification succeeds.
 *
 * CONFIRMED LIVE (2026-08-13, pushnotification_unregistered delivery): the top-level POST body is
 * the full pass row itself (identifier, userProvidedId, operatingSystem, noOfActivePasses,
 * noOfInactivePasses, the template's own custom field keys, ...) with `signature`/`signedData`
 * appended - `signedData` re-serializes that same body (itself carrying its own nested
 * signature/signedData one level deeper; only the outer level needs verifying/parsing, the deeper
 * nesting is presumably an artifact of PassCreator's own delivery-log rendering, not something we
 * need to walk). Confirms the {signedData, signature} envelope shape assumed here.
 *
 * pass_voided's own payload shape is CONFIRMED, and it's not what was assumed here before
 * 2026-08-19 (developer.passcreator.com/en/webhooks/pass-hooks): there is no top-level `voided`
 * field at all, and no field anywhere in any event's payload names which event fired - PassCreator
 * relies entirely on which subscribed target URL received the delivery for that. `voided` on
 * `PassCreatorWebhookData` below is therefore never set from the wire; it's set by the caller
 * (apps/web/src/wallet-webhook.ts's `isVoidedRoute`) once it already knows, from the URL alone,
 * that this delivery is a pass_voided one. Still genuinely unconfirmed: whether
 * first_pushnotification_registered's payload includes `firstDownloadedAt` - only
 * pushnotification_unregistered has been observed live so far.
 */
export interface PassCreatorWebhookEnvelope {
  signedData: string;
  signature: string;
}

/** Fields read from a webhook delivery's (verified) signedData - deliberately permissive (all
 * optional) since we apply whatever's present rather than requiring an exact shape.
 *
 * `noOfActivePasses`/`noOfInactivePasses` + `operatingSystem` (confirmed live 2026-08-13) is a
 * DIFFERENT shape than the v3 search endpoint's per-platform
 * noOfActiveRegistrationsAppleWallet/...GoogleWallet fields (packages/wallet/src/passcreator-
 * client.ts) - the webhook fires per specific device/platform event and reports that platform's
 * own counts, not a global split across both. `operatingSystem` names which of the two platforms
 * this delivery's counts belong to - confirmed live 2026-08-13 as exactly "iOS" (Apple) and
 * "AndroidGooglePay" (Google); NOT the bare "Android" earlier assumed. "iPadOS"/"macOS" are
 * additionally treated as Apple (Wallet runs on all three) even though only "iOS" itself has been
 * observed. Anything else - absent, empty, a typo - is left untouched rather than guessed, since
 * guessing wrong would silently corrupt the other platform's columns. */
export interface PassCreatorWebhookData {
  identifier?: string;
  userProvidedId?: string;
  voided?: boolean;
  operatingSystem?: string;
  noOfActivePasses?: number;
  noOfInactivePasses?: number;
  firstDownloadedAt?: string | null;
}

/** True if `signature` (hex) validates against `signedData` (verified as raw string bytes, never
 * a re-serialized object) using `publicKeyPem`. ECDSA P-256, per the documented example's PEM key.
 *
 * SHA1, not SHA256: developer.passcreator.com/en/signatures/verify-a-signature's own code example
 * calls PHP's `openssl_verify($data, hex2bin($signature), $publicKey)` with only 3 arguments - the
 * docs never say "SHA1" in words, but PHP's `openssl_verify()` defaults its 4th `$algorithm`
 * parameter to `OPENSSL_ALGO_SHA1` when omitted, and the example omits it. A wrong guess here
 * fails closed (rejecting genuine webhooks rather than accepting forged ones - see module doc),
 * which is what SHA256 was silently doing before this was traced back to the PHP default. */
export function verifyWebhookSignature(
  signedData: string,
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  try {
    const verifier = createVerify("SHA1");
    verifier.update(signedData, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, signatureHex, "hex");
  } catch {
    return false;
  }
}

/** Parses and type-narrows the outer envelope from an unknown request body - returns null for
 * anything that doesn't look like {signedData: string, signature: string}, never throws. */
export function parseWebhookEnvelope(body: unknown): PassCreatorWebhookEnvelope | null {
  if (!body || typeof body !== "object") return null;
  const signedData = (body as Record<string, unknown>)["signedData"];
  const signature = (body as Record<string, unknown>)["signature"];
  if (typeof signedData !== "string" || typeof signature !== "string") return null;
  if (!signedData || !signature) return null;
  return { signedData, signature };
}

/** Parses the (already signature-verified) signedData string into the fields we care about -
 * still defensive about individual field shapes, since a verified-but-differently-shaped payload
 * should be handled (no-op) rather than throw. */
export function parseWebhookData(signedData: string): PassCreatorWebhookData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(signedData);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const data: PassCreatorWebhookData = {};
  if (typeof r["identifier"] === "string") data.identifier = r["identifier"];
  if (typeof r["userProvidedId"] === "string") data.userProvidedId = r["userProvidedId"];
  if (typeof r["voided"] === "boolean") data.voided = r["voided"];
  if (typeof r["operatingSystem"] === "string") data.operatingSystem = r["operatingSystem"];
  if (typeof r["noOfActivePasses"] === "number") data.noOfActivePasses = r["noOfActivePasses"];
  if (typeof r["noOfInactivePasses"] === "number") data.noOfInactivePasses = r["noOfInactivePasses"];
  if (typeof r["firstDownloadedAt"] === "string" || r["firstDownloadedAt"] === null) {
    data.firstDownloadedAt = r["firstDownloadedAt"] as string | null;
  }
  return data;
}

/** admitto:{eventId}:{attendeeId} - our own userProvidedId scheme (packages/wallet/src/types.ts).
 * Returns null for anything else (an agency-style or malformed id), so the caller can fall back
 * to matching by provider_pass_id/identifier instead. */
export function parseAdmittoUserProvidedId(userProvidedId: string): { eventId: string; attendeeId: string } | null {
  const parts = userProvidedId.split(":");
  if (parts.length !== 3 || parts[0] !== "admitto") return null;
  const eventId = parts[1];
  const attendeeId = parts[2];
  if (!eventId || !attendeeId) return null;
  return { eventId, attendeeId };
}

/**
 * Applies a (caller-verified) webhook payload to the matching WalletPass row - matches by
 * user_provided_id first (our own deterministic id, present whenever userProvidedId parses),
 * falling back to provider_pass_id/identifier. A no-op (not an error) when nothing matches: the
 * pass may have since been deleted (GDPR erasure), or this is a delivery for a pass we don't
 * recognize.
 *
 * Idempotent by construction: every field here is a `set`, not an increment, so processing the
 * same delivery twice (PassCreator's retryEnabled: true can redeliver) has no different effect
 * than processing it once.
 */
function webhookMatchWhere(data: PassCreatorWebhookData): Prisma.WalletPassWhereUniqueInput | null {
  if (data.userProvidedId) {
    return { provider_user_provided_id: { provider: "passcreator", user_provided_id: data.userProvidedId } };
  }
  if (data.identifier) {
    return { provider_provider_pass_id: { provider: "passcreator", provider_pass_id: data.identifier } };
  }
  return null;
}

// operatingSystem names which platform's counts this delivery carries. Confirmed live 2026-08-13
// on two separate deliveries: "iOS" (Apple) and "AndroidGooglePay" (Google) - PassCreator's own
// enum label, not the device's literal OS name (hence not just "Android"). "iPadOS"/"macOS" are
// additionally recognized as Apple (Wallet runs on all three) even though only "iOS" itself has
// been observed. The full enum (developer.passcreator.com/en/webhooks/pass-hooks, confirmed
// 2026-08-19): iOS, AndroidGooglePay, Android, AndroidWalletPasses, AndroidWalletUnion,
// WindowsPhone - the plain "Android"/AndroidWalletPasses/AndroidWalletUnion variants were missing
// here entirely (every delivery reporting one of them left both platforms' counts untouched, not
// just the wrong one). WindowsPhone isn't a wallet platform Admitto issues passes for and stays
// unrecognized on purpose. Without a recognized value we can't tell which pair of
// apple_*/google_* columns noOfActivePasses/noOfInactivePasses belongs to, so both stay untouched
// rather than guessing - covers the field being absent as well as a genuinely unrecognized label.
// Split out from applyWebhookUpdate to keep its cognitive complexity within SonarCloud's
// threshold.
const APPLE_OPERATING_SYSTEMS = new Set(["ios", "ipados", "macos"]);
const GOOGLE_OPERATING_SYSTEMS = new Set(["androidgooglepay", "android", "androidwalletpasses", "androidwalletunion"]);

function applyRegistrationCounts(updateData: Prisma.WalletPassUpdateInput, data: PassCreatorWebhookData): void {
  if (data.operatingSystem === undefined) return;
  const os = data.operatingSystem.toLowerCase();
  const isApple = APPLE_OPERATING_SYSTEMS.has(os);
  if (!isApple && !GOOGLE_OPERATING_SYSTEMS.has(os)) return;
  if (data.noOfActivePasses !== undefined) {
    if (isApple) updateData.apple_active_registrations = data.noOfActivePasses;
    else updateData.google_active_registrations = data.noOfActivePasses;
  }
  if (data.noOfInactivePasses !== undefined) {
    if (isApple) updateData.apple_inactive_registrations = data.noOfInactivePasses;
    else updateData.google_inactive_registrations = data.noOfInactivePasses;
  }
}

export async function applyWebhookUpdate(
  db: PrismaClient,
  data: PassCreatorWebhookData,
): Promise<{ matched: boolean }> {
  const where = webhookMatchWhere(data);
  if (!where) return { matched: false };

  const updateData: Prisma.WalletPassUpdateInput = { registration_checked_at: new Date() };
  applyRegistrationCounts(updateData, data);
  if (data.firstDownloadedAt !== undefined) {
    updateData.first_downloaded_at = data.firstDownloadedAt;
  }
  if (data.voided === true) {
    updateData.status = "voided";
    updateData.voided_at = new Date();
  } else if (data.voided === false) {
    updateData.status = "active";
    updateData.voided_at = null;
  }

  try {
    await db.walletPass.update({ where, data: updateData });
    return { matched: true };
  } catch (err) {
    // P2025 ("record to update not found") is the only expected failure here - the pass may have
    // been erased since PassCreator queued this delivery, not an error worth surfacing. Anything
    // else (a transient DB outage, a timeout) must propagate: the caller returns a bare 200 for a
    // matched:false result either way, and PassCreator's own retry mechanism only redelivers on a
    // non-2xx response - swallowing a real failure here would silently drop the update for good.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { matched: false };
    }
    throw err;
  }
}
