import { createHmac, timingSafeEqual } from "node:crypto";
import { getEncryptionKey } from "./key.js";

/** Domain separator: the app's one HMAC key signs more than one thing, so the input is prefixed
 * (same approach as hashRecipientForRateLimit in apps/web) rather than deriving a second key. */
const CONFIRM_MAC_DOMAIN = "registration-confirm:";

/**
 * Stateless signature for the e-mail confirmation link of a guest registration:
 * `base64url(HMAC-SHA256(getEncryptionKey(), "registration-confirm:" + registrationId))`.
 * Deterministic, so a re-sent confirmation mail carries the identical link, and nothing about it
 * is stored. Expiry is not part of the signature - the caller checks `confirm_expires_at`.
 */
export function signRegistrationConfirm(registrationId: string): string {
  return createHmac("sha256", getEncryptionKey())
    .update(`${CONFIRM_MAC_DOMAIN}${registrationId}`)
    .digest("base64url");
}

/** Constant-time check of a link's `mac` against the one {@link signRegistrationConfirm} gives
 * for `registrationId`. A mac of the wrong length is refused without a comparison. */
export function verifyRegistrationConfirm(registrationId: string, mac: string): boolean {
  const expected = Buffer.from(signRegistrationConfirm(registrationId));
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
