/**
 * The value of the OAuth `state` of a guest's company sign-in (D-C4), and what is read out of it.
 *
 * The callback of every event is ONE address (`/sso/callback`), so it does not know which event the guest came from. The
 * value is `<43 random characters>.<slug of the event>`:
 *
 * - The random part is the secret that makes the flow unguessable, and its first characters name the flow cookie, so two
 *   flows of one browser (two events in two tabs) never overwrite each other's cookie.
 * - The slug is a HINT, nothing more: it is read only to send a guest whose sign-in stopped before the state was spent
 *   (the provider sent no `code`, the state ran out, the flow cookie is missing) back to the form they began from, as
 *   `/r/<slug>`. It has been through the regular expression of a slug, and it is never used to find an event, to key the
 *   state, to set a cookie of the event or to decide anything: the event, the provider and the slug of a flow that goes on
 *   come from the row of the state, once it is spent.
 */
import { generateOauthSecret } from "@admitto/auth";

/** The prefix of the name of a flow cookie; the rest of the name comes from the random part of the `state`. */
export const GUEST_SSO_FLOW_COOKIE_PREFIX = "admitto_reg_sso_flow_";

/** An event slug as the create-event form allows it; the same as the page's, so a path that cannot be an event is the 404. */
export const EVENT_SLUG = /^[a-z0-9_-]{1,80}$/;

/** The random part is `generateOauthSecret()`: 32 bytes as base64url. */
const STATE_SHAPE = /^([A-Za-z0-9_-]{43})\.([a-z0-9_-]{1,80})$/;

/** How many characters of the random part name the cookie: 96 bits, so two flows never share a name. */
const COOKIE_ID_CHARS = 16;

/** A `state` of ours: the whole value, the slug it carries as a hint, and the name of the flow cookie that goes with it. */
export interface GuestSsoStateValue {
  value: string;
  /** Only a hint, see the head of this file. */
  slug: string;
  cookieName: string;
}

function withParts(secret: string, slug: string): GuestSsoStateValue {
  return { value: `${secret}.${slug}`, slug, cookieName: `${GUEST_SSO_FLOW_COOKIE_PREFIX}${secret.slice(0, COOKIE_ID_CHARS)}` };
}

/** A new `state` for a flow begun for the event with this slug (already checked against {@link EVENT_SLUG}). */
export function newGuestSsoStateValue(slug: string): GuestSsoStateValue {
  return withParts(generateOauthSecret(), slug);
}

/** The parts of a `state` that has the shape of ours, or null. A value of any other shape is not a flow of ours. */
export function parseGuestSsoStateValue(value: string): GuestSsoStateValue | null {
  const match = STATE_SHAPE.exec(value);
  return match === null ? null : withParts(match[1]!, match[2]!);
}
