/**
 * The two cookies of a guest's company sign-in (D-C4), and nothing else the sign-in leaves in the browser.
 *
 * - The FLOW cookie binds the callback to the browser that began the flow (login CSRF): without it, anyone could hand a
 *   guest a link to the callback with a `code` and a `state` of their own, and the guest would register under the
 *   attacker's identity. The callback is one address for the whole instance (`/sso/callback`), so there is one flow cookie
 *   PER FLOW: its name is the prefix and the first characters of the random part of the `state`, its value is the whole
 *   `state`, and two flows of one browser (two events in two tabs) never overwrite each other. It is read only by the
 *   callback, whose path it has, and it is deleted by every callback, whatever came of it.
 * - The SESSION cookie says who signed in: the provider, the provider's id of the person (`sub`), the address the provider
 *   gave, when, and which allowed value the claim of the event's restriction held. It is signed, so it cannot be made or
 *   changed by the guest, and it is the only thing the page and `POST /r/<slug>` trust about the person. It is NOT a row of
 *   the table of staff sessions and gives no access to anything but this one form: signing in creates no account, no
 *   session and no permission of staff.
 *
 * Both are host-only (no `Domain`), `HttpOnly`, `Secure` outside development and `SameSite=Lax` (the callback is a top-level
 * navigation from the provider, which a `Strict` cookie would not travel with). The session is bound to the event twice, by
 * the path of the cookie and by what is signed, so a cookie of one event is nothing at another.
 *
 * A cookie that is forged, changed, expired, of another event, another slug or another provider is read as no cookie, and
 * nothing tells the guest which: the page asks them to sign in again.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { OIDC_AUTH_STATE_TTL_MS } from "@admitto/auth";
import { getEncryptionKey } from "@admitto/crypto";
import type { ClaimProof } from "./sso-claim.js";
import type { GuestSsoStateValue } from "./sso-state-value.js";

/** The one address the provider sends every guest back to, on the host the guest began on. Not under `/r/`, so it can never
 * be the page of an event, whatever slug an event has. The flow cookies have it as their path. */
export const GUEST_SSO_CALLBACK_PATH = "/sso/callback";

export const GUEST_SSO_SESSION_COOKIE = "admitto_reg_sso";

/** How long the state of a flow lives: that of the staff flow. */
export const GUEST_SSO_STATE_TTL_MS = OIDC_AUTH_STATE_TTL_MS;
/** How long a sign-in lasts: long enough to fill in a form, short enough to be a loan and not a login. */
export const GUEST_SSO_SESSION_TTL_MS = 30 * 60 * 1000;

/** Domain separator: the app's one HMAC key signs more than one thing (see `signRegistrationConfirm`), so the input is
 * prefixed with a name no other signature uses. `v1` is the version of the payload below. */
const SESSION_MAC_DOMAIN = "registration-sso-session:v1:";

/** A clock that runs ahead of ours by this much is believed (several instances, none exactly right); further is a forgery. */
const CLOCK_SKEW_MS = 60_000;

/** A cookie is at most 4 KB; ours is a few hundred bytes. Anything longer is not ours. */
const MAX_COOKIE_CHARS = 2_048;

const SUBJECT_MAX = 255;
const EMAIL_MAX = 320;
const ID_MAX = 128;
const CLAIM_PART_MAX = 200;

/** Who signed in, as the cookie carries it. */
export interface GuestSsoIdentity {
  providerId: string;
  /** The provider's stable id of the person. */
  subject: string;
  /** The address the provider gave, normalised (lower case, trimmed). Contact data: the person is the pair above. */
  email: string;
  /** When the sign-in was issued, in milliseconds. */
  issuedAt: number;
  /** Which allowed value the claim of the event's restriction held, when the event has one. */
  proof: ClaimProof | null;
}

/** Where a sign-in is used: what the cookie must agree with, all of it read from the event and the settings by the caller. */
export interface GuestSsoScope {
  eventId: string;
  slug: string;
  providerId: string;
}

interface SessionPayload {
  v: 1;
  /** The id of the event. */
  ev: string;
  /** Its slug. */
  sl: string;
  /** The provider. */
  pr: string;
  /** The subject. */
  su: string;
  /** The address. */
  em: string;
  /** Issued at, in milliseconds. */
  iat: number;
  /** The claim of the restriction and the value it held, together or not at all. */
  cn?: string;
  cv?: string;
}

const secure = (): boolean => process.env["NODE_ENV"] !== "development";

const sessionPath = (slug: string): string => `/r/${slug}`;

// ---------------------------------------------------------------------------------------------------------------------
// The flow cookie

/** Sets the flow cookie of the sign-in that was begun with this `state`. It lives as long as the state does, and no longer. */
export function setGuestSsoFlowCookie(c: Context, flow: GuestSsoStateValue): void {
  setCookie(c, flow.cookieName, flow.value, {
    httpOnly: true,
    secure: secure(),
    sameSite: "Lax",
    path: GUEST_SSO_CALLBACK_PATH,
    maxAge: Math.floor(GUEST_SSO_STATE_TTL_MS / 1000),
  });
}

/** Deletes the flow cookie of this flow. Every callback does it, whether the sign-in worked or not. */
export function clearGuestSsoFlowCookie(c: Context, flow: GuestSsoStateValue): void {
  deleteCookie(c, flow.cookieName, { path: GUEST_SSO_CALLBACK_PATH, secure: secure() });
}

/** Whether the browser holds the flow cookie of this very flow: it is there, and it is the `state` of the callback. */
export function guestSsoFlowCookieMatches(c: Context, flow: GuestSsoStateValue): boolean {
  const value = getCookie(c, flow.cookieName);
  if (value === undefined || value === "") return false;
  const held = Buffer.from(value);
  const expected = Buffer.from(flow.value);
  return held.length === expected.length && timingSafeEqual(held, expected);
}

// ---------------------------------------------------------------------------------------------------------------------
// The session cookie

function mac(encodedPayload: string): Buffer {
  return createHmac("sha256", getEncryptionKey()).update(`${SESSION_MAC_DOMAIN}${encodedPayload}`).digest();
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const claimKeys = (record["cn"] === undefined ? 0 : 1) + (record["cv"] === undefined ? 0 : 1);
  return (
    record["v"] === 1 &&
    isBoundedString(record["ev"], ID_MAX) &&
    isBoundedString(record["sl"], ID_MAX) &&
    isBoundedString(record["pr"], ID_MAX) &&
    isBoundedString(record["su"], SUBJECT_MAX) &&
    isBoundedString(record["em"], EMAIL_MAX) &&
    typeof record["iat"] === "number" &&
    Number.isFinite(record["iat"]) &&
    (claimKeys === 0 || (claimKeys === 2 && isBoundedString(record["cn"], CLAIM_PART_MAX) && isBoundedString(record["cv"], CLAIM_PART_MAX)))
  );
}

/** The value of the session cookie for a sign-in: `base64url(payload).base64url(signature)`. */
export function signGuestSsoSession(scope: GuestSsoScope, identity: Omit<GuestSsoIdentity, "providerId">): string {
  const payload: SessionPayload = {
    v: 1,
    ev: scope.eventId,
    sl: scope.slug,
    pr: scope.providerId,
    su: identity.subject,
    em: identity.email,
    iat: identity.issuedAt,
    ...(identity.proof ? { cn: identity.proof.name, cv: identity.proof.value } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${mac(encoded).toString("base64url")}`;
}

/**
 * The sign-in a cookie value carries for `scope` at `now`, or null: not ours, not signed by us, not for this event, slug or
 * provider, older than {@link GUEST_SSO_SESSION_TTL_MS}, or issued in the future.
 */
export function verifyGuestSsoSession(value: string | undefined, scope: GuestSsoScope, now: number): GuestSsoIdentity | null {
  if (value === undefined || value.length === 0 || value.length > MAX_COOKIE_CHARS) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];
  const given = Buffer.from(signature, "base64url");
  const expected = mac(encoded);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(payload)) return null;
  if (payload.ev !== scope.eventId || payload.sl !== scope.slug || payload.pr !== scope.providerId) return null;
  const age = now - payload.iat;
  if (age >= GUEST_SSO_SESSION_TTL_MS || age < -CLOCK_SKEW_MS) return null;
  return {
    providerId: payload.pr,
    subject: payload.su,
    email: payload.em,
    issuedAt: payload.iat,
    proof: payload.cn !== undefined && payload.cv !== undefined ? { name: payload.cn, value: payload.cv } : null,
  };
}

/** Gives the browser the sign-in. */
export function setGuestSsoSessionCookie(c: Context, scope: GuestSsoScope, identity: Omit<GuestSsoIdentity, "providerId">): void {
  setCookie(c, GUEST_SSO_SESSION_COOKIE, signGuestSsoSession(scope, identity), {
    httpOnly: true,
    secure: secure(),
    sameSite: "Lax",
    path: sessionPath(scope.slug),
    maxAge: Math.floor(GUEST_SSO_SESSION_TTL_MS / 1000),
  });
}

/** Takes the sign-in from the browser: after a registration was made (it is spent), or when it turned out not to be good. */
export function clearGuestSsoSessionCookie(c: Context, slug: string): void {
  deleteCookie(c, GUEST_SSO_SESSION_COOKIE, { path: sessionPath(slug), secure: secure() });
}

/** The sign-in the request carries for `scope`, or null. */
export function readGuestSsoSession(c: Context, scope: GuestSsoScope, now: number): GuestSsoIdentity | null {
  return verifyGuestSsoSession(getCookie(c, GUEST_SSO_SESSION_COOKIE), scope, now);
}
