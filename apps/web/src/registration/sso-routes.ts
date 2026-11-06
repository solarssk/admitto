/**
 * `GET /r/:slug/sso/start` and `GET /sso/callback`: a guest signs in with the company's identity provider to fill in the
 * registration form of an event whose way in is the company sign-in (D-C4). The provider is the one staff sign in with,
 * but the sign-in of a guest creates NO account of staff, no session of staff and no permission: it does not call
 * `resolveOrCreateUserFromExternalIdentity`, `createSession` or `applyOidcGroupRoleMappings`, and a test counts the rows of
 * those tables before and after a whole flow. What it leaves is two cookies (./sso-session.ts) and a row of state that the
 * worker deletes.
 *
 * The start is the page of an event (`/r/<slug>/sso/start`), the callback is ONE address for the instance (`/sso/callback`,
 * {@link buildGuestSsoRedirectUri}), so the provider's administrator lists one address once and every event with the company
 * sign-in works without a new entry. The callback therefore does not know the event: it reads it from the row of the state,
 * once the state is spent.
 *
 * Anonymous, and the callback is where a stranger could make a guest sign in as somebody else, so its order is:
 *
 * 1. The cross-site check is not needed (both are plain navigations that change nothing the guest has), the limiter per
 *    client address is (`registration:sso`, in front of the handlers: every start writes a row).
 * 2. A `state` of a shape that is not ours (./sso-state-value.ts) is refused with the one 404.
 * 3. A callback without the FLOW COOKIE of that state, or without a `code`, is refused here, before anything that depends on
 *    the `code` is done: no read of the database, no call to the provider. This is the login-CSRF check. The slug in the
 *    `state` is only a hint, used to send the guest back to the form they began from, as `/r/<slug>`.
 * 4. The state is spent, once, by a conditional update. The event, its slug and the provider are the ones of the row.
 * 5. The event is looked up by the rules of the page: it is open, and its way in is the company sign-in; else the 404. It
 *    and the provider must be the ones of the state.
 * 6. The code is exchanged and the ID token validated (signature, issuer, audience, nonce, expiry), with the PKCE verifier
 *    of the state.
 * 7. The token is judged by `identityFromToken` (./sso-identity.ts): the `sub`, the restriction to a company, the address.
 * 8. Only now the guest gets their sign-in: the signed cookie. The flow cookie is deleted by every callback, and the answer is
 *    a redirect to the page, never to an address that came in the request.
 *
 * Every answer is `no-store` and `Referrer-Policy: no-referrer`. A refusal goes back to the page with one word of a closed
 * set in the query (`?sso=failed|no_email|not_allowed`), which the page maps to a sentence of its own; the provider's error
 * text, and everything else it sent, is never repeated. Nothing that identifies a guest, and no `code`, `state` or token, is
 * written to a log; a refusal logs its fixed reason and the id of the event.
 */
import type { Context } from "hono";
import {
  buildOidcAuthorizeUrl,
  codeChallengeS256,
  exchangeAndValidateIdToken,
  findOidcProviderById,
  generateCodeVerifier,
  generateOauthSecret,
} from "@admitto/auth";
import type { PrismaClient } from "@admitto/db";
import { emitSystemLog } from "@admitto/shared/system-log";
import { respondRegistrationNotFound } from "../registration-page-security.js";
import { resolveRegistration, type GuestAccess, type ResolvedRegistration } from "./form-model.js";
import { identityFromToken, noticeFor, type SsoNotice, type SsoRefusal } from "./sso-identity.js";
import {
  GUEST_SSO_CALLBACK_PATH,
  clearGuestSsoFlowCookie,
  clearGuestSsoSessionCookie,
  guestSsoFlowCookieMatches,
  setGuestSsoFlowCookie,
  setGuestSsoSessionCookie,
} from "./sso-session.js";
import { createGuestSsoState, spendGuestSsoState, type SpentGuestSsoState } from "./sso-state.js";
import { EVENT_SLUG, newGuestSsoStateValue, parseGuestSsoStateValue, type GuestSsoStateValue } from "./sso-state-value.js";

/**
 * The one place that builds the address the provider sends the guest back to: ONE for the whole instance, the same for every
 * event, so it is entered at the provider once. It is the address of the instance, as the redirect of staff is. The cookies
 * of the flow are host-only, so the guest must start and finish on the same host: when events have an address of their own
 * (PR 119) this is the function that takes that address as its base, and the provider must have one such address per host
 * in its list of allowed redirects.
 */
export function buildGuestSsoRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}${GUEST_SSO_CALLBACK_PATH}`;
}

/** What a `code` and a `state` can be: the longest the parameters of a callback are read at. */
const MAX_CODE_CHARS = 4_096;
const MAX_STATE_CHARS = 256;

export interface RegistrationSsoDeps {
  db: PrismaClient;
  /** The address of the instance (what the redirect of the provider is built on), or a rejection when it is not set. */
  baseUrl: () => Promise<string>;
}

type OpenRegistration = Extract<ResolvedRegistration, { kind: "open" }>;
type OpenSso = OpenRegistration & { access: Extract<GuestAccess, { method: "sso" }> };

function isOpenSso(target: ResolvedRegistration): target is OpenSso {
  return target.kind === "open" && target.access.method === "sso";
}

/** Why a flow stopped, for the system log: a fixed set, never anything the request or the provider said. */
type FailureReason =
  | "missing_code_or_state"
  | "flow_cookie_mismatch"
  | "state_invalid"
  | "state_mismatch"
  | "provider_unavailable"
  | "instance_url_missing"
  | "token_validation"
  | "internal"
  | SsoRefusal;

function noStore(c: Context): void {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
}

function logRefusal(reason: FailureReason, eventId?: string): void {
  emitSystemLog("security", "warn", "registration_sso_refused", { reason, ...(eventId === undefined ? {} : { event_id: eventId }) });
}

/** Back to the page of the event with the word of a notice, and the flow cookie of this flow deleted. The path is a slug that
 * is checked, never an address from the request. */
function backToPage(c: Context, flow: GuestSsoStateValue | null, slug: string, notice: SsoNotice | null): Response {
  if (flow !== null) clearGuestSsoFlowCookie(c, flow);
  return c.redirect(notice === null ? `/r/${slug}` : `/r/${slug}?sso=${notice}`, 302);
}

/**
 * A refusal: back to the form of `slug` with the notice, and the flow cookie of this flow deleted. It also takes away a
 * sign-in the browser may still hold (up to 30 minutes), so the page cannot show the previous person's address and a submit
 * cannot use their identity. The slug is the one of the row of the event, or (before the state is spent) the hint in the
 * `state`: a string that has the shape of a slug, so the answer is a redirect to `/r/<that>` and to nothing else, and the
 * only other effect is on the cookies of the guest's own browser.
 */
function refuse(
  c: Context,
  flow: GuestSsoStateValue | null,
  slug: string,
  reason: FailureReason,
  notice: SsoNotice,
  eventId?: string,
): Response {
  logRefusal(reason, eventId);
  clearGuestSsoSessionCookie(c, slug);
  return backToPage(c, flow, slug, notice);
}

/**
 * A refusal of a callback that carries no `state` of the shape of ours: there is no page to go back to, so it is the one 404
 * (and nothing else is done, no cookie is touched).
 */
function refuseUnknown(c: Context, reason: FailureReason): Response {
  logRefusal(reason);
  return respondRegistrationNotFound(c);
}

/** The event when it is open and its way in is the company sign-in. */
async function openSsoEvent(db: PrismaClient, slug: string): Promise<OpenSso | null> {
  const target = await resolveRegistration(db, slug, new Date());
  return isOpenSso(target) ? target : null;
}

/**
 * `GET /r/:slug/sso/start`: for an event that is open and has the company sign-in, a state is written, the flow cookie is
 * set, and the guest is sent to the provider. Any other event is the one 404, so the route tells a stranger nothing the page
 * does not.
 */
export async function handleSsoStart(c: Context, deps: RegistrationSsoDeps): Promise<Response> {
  noStore(c);
  const slug = c.req.param("slug") ?? "";
  if (!EVENT_SLUG.test(slug)) return respondRegistrationNotFound(c);
  try {
    const target = await openSsoEvent(deps.db, slug);
    if (!target) return respondRegistrationNotFound(c);
    const provider = await findOidcProviderById(deps.db, target.access.providerId);
    if (!provider?.enabled) return respondRegistrationNotFound(c);

    let baseUrl: string;
    try {
      baseUrl = await deps.baseUrl();
    } catch {
      return refuse(c, null, slug, "instance_url_missing", "failed", target.eventId);
    }
    const flow = newGuestSsoStateValue(slug);
    const nonce = generateOauthSecret();
    const codeVerifier = generateCodeVerifier();
    await createGuestSsoState(
      deps.db,
      { state: flow.value, nonce, codeVerifier, eventId: target.eventId, providerId: provider.id },
      new Date(),
    );
    setGuestSsoFlowCookie(c, flow);
    return c.redirect(
      buildOidcAuthorizeUrl(provider, {
        redirectUri: buildGuestSsoRedirectUri(baseUrl),
        state: flow.value,
        nonce,
        codeChallenge: codeChallengeS256(codeVerifier),
      }),
      302,
    );
  } catch (error) {
    return failed(c, null, slug, error);
  }
}

/** An unexpected failure: the class of the error and nothing else is logged (the message of a database or network error can
 * carry a value), and the guest is back at the page with the general notice. */
function failed(c: Context, flow: GuestSsoStateValue | null, slug: string, error: unknown): Response {
  console.error("registration sso failed:", { reason: error instanceof Error ? error.name : "unknown" });
  return refuse(c, flow, slug, "internal", "failed");
}

/** The parameter as a string of a sane length, or null. */
function param(c: Context, name: string, max: number): string | null {
  const value = c.req.query(name);
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/**
 * `GET /sso/callback`: the provider sent the guest back. See the head of this file for the order.
 */
export async function handleSsoCallback(c: Context, deps: RegistrationSsoDeps): Promise<Response> {
  noStore(c);
  const state = param(c, "state", MAX_STATE_CHARS);
  if (state === null) return refuseUnknown(c, "missing_code_or_state");
  const flow = parseGuestSsoStateValue(state);
  if (flow === null) return refuseUnknown(c, "state_invalid");

  // Before anything that depends on the code: the browser must be the one that began this flow (login CSRF). The slug of the
  // state is only a hint, so far (anyone can write one): it names the page to go back to, as `/r/<slug>`, and nothing else.
  if (!guestSsoFlowCookieMatches(c, flow)) return refuse(c, flow, flow.slug, "flow_cookie_mismatch", "failed");
  const code = param(c, "code", MAX_CODE_CHARS);
  // The provider sent the guest back without a code (they declined, or it failed): the flow is theirs, and it ends here.
  if (code === null) return refuse(c, flow, flow.slug, "missing_code_or_state", "failed");

  try {
    return await finishSignIn(c, deps, flow, code);
  } catch (error) {
    // Only the spending of the state can end up here: the hint of the state is all there is to go back by.
    return failed(c, flow, flow.slug, error);
  }
}

async function finishSignIn(c: Context, deps: RegistrationSsoDeps, flow: GuestSsoStateValue, code: string): Promise<Response> {
  const spent = await spendGuestSsoState(deps.db, flow.value, new Date());
  if (spent === null) return refuse(c, flow, flow.slug, "state_invalid", "failed");
  try {
    return await signInForEvent(c, deps, flow, spent, code);
  } catch (error) {
    // From here on the page to go back to, and the sign-in cookie to take away, are the event's own (the row), not the hint.
    return failed(c, flow, spent.eventSlug, error);
  }
}

async function signInForEvent(
  c: Context,
  deps: RegistrationSsoDeps,
  flow: GuestSsoStateValue,
  spent: SpentGuestSsoState,
  code: string,
): Promise<Response> {
  const { db } = deps;
  // The event, its slug and the provider are the ones the state was written for, not anything the request said.
  const { eventId, eventSlug: slug } = spent;

  const target = await openSsoEvent(db, slug);
  if (!target) {
    clearGuestSsoFlowCookie(c, flow);
    return respondRegistrationNotFound(c);
  }
  if (target.eventId !== eventId || spent.providerId !== target.access.providerId) {
    return refuse(c, flow, slug, "state_mismatch", "failed", eventId);
  }
  const provider = await findOidcProviderById(db, spent.providerId);
  if (!provider?.enabled) return refuse(c, flow, slug, "provider_unavailable", "failed", eventId);

  let baseUrl: string;
  try {
    baseUrl = await deps.baseUrl();
  } catch {
    return refuse(c, flow, slug, "instance_url_missing", "failed", eventId);
  }
  let payload;
  try {
    ({ payload } = await exchangeAndValidateIdToken(
      provider,
      code,
      spent.codeVerifier,
      buildGuestSsoRedirectUri(baseUrl),
      spent.nonce,
    ));
  } catch {
    // What the provider or the library said is not repeated: it can name a claim, an address or a client.
    return refuse(c, flow, slug, "token_validation", "failed", eventId);
  }

  const identity = identityFromToken(payload, provider, target.access.restriction);
  if (!identity.ok) return refuse(c, flow, slug, identity.reason, noticeFor(identity.reason), eventId);

  setGuestSsoSessionCookie(
    c,
    { eventId, slug, providerId: provider.id },
    { subject: identity.subject, email: identity.email, issuedAt: Date.now(), proof: identity.proof },
  );
  return backToPage(c, flow, slug, null);
}
