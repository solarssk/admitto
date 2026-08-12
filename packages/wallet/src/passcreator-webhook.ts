import { createVerify } from "node:crypto";
import type { Prisma, PrismaClient } from "@admitto/db";

/**
 * Outer envelope PassCreator posts to a subscribed webhook when `signPayload: true` was set at
 * subscribe time (developer.passcreator.com/en/signatures/verify-a-signature). `signedData` is
 * signed as-is (the exact string bytes, not a re-serialization of parsed JSON) - verify it BEFORE
 * calling JSON.parse on it, and never trust the parsed contents until verification succeeds.
 *
 * UNCONFIRMED (2026-08-13): docs show this signature scheme for API responses in general, not a
 * concrete example of a webhook delivery body specifically - the exact field names here, and
 * whether there is a separate discriminator field for which of the 4 subscribed events this is,
 * needs confirming against a real delivery before this is trusted in production (see the wallet
 * webhook task list / bug report companion doc).
 */
export interface PassCreatorWebhookEnvelope {
  signedData: string;
  signature: string;
}

/** Fields observed on PassCreator search-result rows (packages/wallet/src/passcreator-client.ts)
 * that a webhook delivery's signedData is expected to carry a subset of - deliberately permissive
 * (all optional) since we apply whatever's present rather than requiring an exact shape. */
export interface PassCreatorWebhookData {
  identifier?: string;
  userProvidedId?: string;
  voided?: boolean;
  noOfActiveRegistrationsAppleWallet?: number;
  noOfInactiveRegistrationsAppleWallet?: number;
  noOfActiveRegistrationsGoogleWallet?: number;
  noOfInactiveRegistrationsGoogleWallet?: number;
  firstDownloadedAt?: string | null;
}

/** True if `signature` (hex) validates against `signedData` (verified as raw string bytes, never
 * a re-serialized object) using `publicKeyPem`. SHA-256/ECDSA P-256, per the documented example -
 * matches the curve PassCreator's own PEM key example uses, but the exact hash algorithm is not
 * spelled out in the docs and needs live confirmation (a wrong guess here fails closed, rejecting
 * genuine webhooks, rather than accepting forged ones - see module doc). */
export function verifyWebhookSignature(
  signedData: string,
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  try {
    const verifier = createVerify("SHA256");
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
  if (typeof r["noOfActiveRegistrationsAppleWallet"] === "number") {
    data.noOfActiveRegistrationsAppleWallet = r["noOfActiveRegistrationsAppleWallet"];
  }
  if (typeof r["noOfInactiveRegistrationsAppleWallet"] === "number") {
    data.noOfInactiveRegistrationsAppleWallet = r["noOfInactiveRegistrationsAppleWallet"];
  }
  if (typeof r["noOfActiveRegistrationsGoogleWallet"] === "number") {
    data.noOfActiveRegistrationsGoogleWallet = r["noOfActiveRegistrationsGoogleWallet"];
  }
  if (typeof r["noOfInactiveRegistrationsGoogleWallet"] === "number") {
    data.noOfInactiveRegistrationsGoogleWallet = r["noOfInactiveRegistrationsGoogleWallet"];
  }
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
export async function applyWebhookUpdate(
  db: PrismaClient,
  data: PassCreatorWebhookData,
): Promise<{ matched: boolean }> {
  const where: Prisma.WalletPassWhereUniqueInput | null = data.userProvidedId
    ? { provider_user_provided_id: { provider: "passcreator", user_provided_id: data.userProvidedId } }
    : data.identifier
      ? { provider_provider_pass_id: { provider: "passcreator", provider_pass_id: data.identifier } }
      : null;
  if (!where) return { matched: false };

  const updateData: Prisma.WalletPassUpdateInput = { registration_checked_at: new Date() };
  if (data.noOfActiveRegistrationsAppleWallet !== undefined) {
    updateData.apple_active_registrations = data.noOfActiveRegistrationsAppleWallet;
  }
  if (data.noOfInactiveRegistrationsAppleWallet !== undefined) {
    updateData.apple_inactive_registrations = data.noOfInactiveRegistrationsAppleWallet;
  }
  if (data.noOfActiveRegistrationsGoogleWallet !== undefined) {
    updateData.google_active_registrations = data.noOfActiveRegistrationsGoogleWallet;
  }
  if (data.noOfInactiveRegistrationsGoogleWallet !== undefined) {
    updateData.google_inactive_registrations = data.noOfInactiveRegistrationsGoogleWallet;
  }
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
  } catch {
    // Prisma throws (P2025) when the where clause matches no row - not an error worth surfacing,
    // the pass may have been erased since PassCreator queued this delivery.
    return { matched: false };
  }
}
