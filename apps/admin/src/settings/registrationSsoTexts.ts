/** The sentences about the return addresses of the company SSO, said on the card of the ways in (Organisation settings) and in the setup for IT of an event. */
export const REDIRECT_HINT =
  "Enter this address once at the identity provider, in its list of allowed redirect (callback) addresses. After a guest signs in, the provider sends the guest back to this address. It is the same for every event that uses Company SSO on the address of this instance.";
export const EVENT_ADDRESS_HINT =
  "Also enter this address at the identity provider. It belongs to the event that uses Company SSO on its own address. Every event address needs its own entry at the identity provider.";
export const UNVERIFIED_NOTE = " This address has not passed its check yet. Enter it now, so sign-in works as soon as the address passes.";
export const GATEWAY_NOTE = "If a gateway such as Cloudflare Access stands in front of Admitto, it must let the paths /sso/callback, /r/* and /legal/* through without asking for a sign-in.";
