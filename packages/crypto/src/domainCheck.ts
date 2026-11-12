import { createHmac, timingSafeEqual } from "node:crypto";
import { getEncryptionKey } from "./key.js";

/** Domain separator: the app's one HMAC key signs more than one thing, so the input is prefixed (as in registrationConfirm.ts). */
const DOMAIN_CHECK_MAC_DOMAIN = "domain-check:";

/**
 * The proof an event's own address gives that it reaches THIS instance, for THAT event (D-C6):
 * `base64url(HMAC-SHA256(getEncryptionKey(), "domain-check:" + eventId + ":" + domain))`.
 *
 * `GET /.well-known/admitto-domain-check` on the address answers it, and the check of the address (PR 120) asks for the same value
 * from its own key and compares. The event and the host are both in the input, so a proof read at one address is nothing at another,
 * and a host that merely points at some other Admitto cannot give it (neither an event id nor an address holds a colon, so the two cannot be shifted into each other). It is deterministic and says nothing of the key or the event id,
 * so the endpoint can be public. `domain` is the lower-case address as it is stored (`custom_domain`).
 */
export function signDomainCheck(eventId: string, domain: string): string {
  return createHmac("sha256", getEncryptionKey())
    .update(`${DOMAIN_CHECK_MAC_DOMAIN}${eventId}:${domain}`)
    .digest("base64url");
}

/** Constant-time check of a `mac` against the one {@link signDomainCheck} gives. A mac of the wrong length is refused without a comparison. */
export function verifyDomainCheck(eventId: string, domain: string, mac: string): boolean {
  const expected = Buffer.from(signDomainCheck(eventId, domain));
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
