/**
 * `GET /r/:slug/sso/start` and `GET /r/:slug/sso/callback`: a guest signs in with the company's identity provider to fill in
 * the registration form of an event whose way in is the company sign-in (D-C4). The provider is the one staff sign in with,
 * but the sign-in of a guest creates NO account of staff, no session of staff and no permission: it does not call
 * `resolveOrCreateUserFromExternalIdentity`, `createSession` or `applyOidcGroupRoleMappings`, and a test counts the rows of
 * those tables before and after a whole flow. What it leaves is two cookies (./sso-session.ts) and a row of state that the
 * worker deletes.
 *
 * Anonymous, and the callback is where a stranger could make a guest sign in as somebody else, so its order is:
 *
 * 1. The cross-site check is not needed (both are plain navigations that change nothing the guest has), the limiter per
 *    client address is (`registration:sso`, in front of the handlers: every start writes a row).
 * 2. The slug is one an event can have, else the one 404 of the registration routes.
 * 3. A callback without a `code` and a `state`, or without the FLOW COOKIE of that state, is refused here, before anything
 *    that depends on the `code` is done: no read of the database, no call to the provider. This is the login-CSRF check.
 * 4. The event is looked up by the rules of the page: it is open, and its way in is the company sign-in; else the 404.
 * 5. The state is spent, once, by a conditional update. The state must be for this event and this provider.
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
  clearGuestSsoFlowCookie,
  clearGuestSsoSessionCookie,
  guestSsoFlowCookieMatches,
  setGuestSsoFlowCookie,
  setGuestSsoSessionCookie,
} from "./sso-session.js";
import { createGuestSsoState, spendGuestSsoState } from "./sso-state.js";

/**
 * The one place that builds the address the provider sends the guest back to. It is the address of the instance, as the
 * redirect of staff is. The cookies of the flow are host-only, so the guest must start and finish on the same host: when
 * an event has an address of its own (PR 119) this is the function that moves to it, and the provider must have the address
 * in its list of allowed redirects.
 */
export function buildGuestSsoRedirectUri(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/$/, "")}/r/${slug}/sso/callback`;
}

/** An event slug as the create-event form allows it; the same as the page's, so a path that cannot be an event is the 404. */
const EVENT_SLUG = /^[a-z0-9_-]{1,80}$/;

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

/** Back to the page of the event with the word of a notice, and the flow cookie deleted. The path is the slug the route
 * matched and the page checked, never an address from the request. */
function backToPage(c: Context, slug: string, notice: SsoNotice | null): Response {
  clearGuestSsoFlowCookie(c, slug);
  return c.redirect(notice === null ? `/r/${slug}` : `/r/${slug}?sso=${notice}`, 302);
}

function refuse(c: Context, slug: string, reason: FailureReason, notice: SsoNotice, eventId?: string): Response {
  emitSystemLog("security", "warn", "registration_sso_refused", { reason, ...(eventId === undefined ? {} : { event_id: eventId }) });
  // A refused callback also takes away a sign-in the browser may still hold (up to 30 minutes), so the page cannot
  // show the previous person's address and a submit cannot use their identity.
  clearGuestSsoSessionCookie(c, slug);
  return backToPage(c, slug, notice);
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
      return refuse(c, slug, "instance_url_missing", "failed", target.eventId);
    }
    const state = generateOauthSecret();
    const nonce = generateOauthSecret();
    const codeVerifier = generateCodeVerifier();
    await createGuestSsoState(
      deps.db,
      { state, nonce, codeVerifier, eventId: target.eventId, providerId: provider.id },
      new Date(),
    );
    setGuestSsoFlowCookie(c, slug, state);
    return c.redirect(
      buildOidcAuthorizeUrl(provider, {
        redirectUri: buildGuestSsoRedirectUri(baseUrl, slug),
        state,
        nonce,
        codeChallenge: codeChallengeS256(codeVerifier),
      }),
      302,
    );
  } catch (error) {
    return failed(c, slug, error);
  }
}

/** An unexpected failure: the class of the error and nothing else is logged (the message of a database or network error can
 * carry a value), and the guest is back at the page with the general notice. */
function failed(c: Context, slug: string, error: unknown): Response {
  console.error("registration sso failed:", { reason: error instanceof Error ? error.name : "unknown" });
  return refuse(c, slug, "internal", "failed");
}

/** The parameter as a string of a sane length, or null. */
function param(c: Context, name: string, max: number): string | null {
  const value = c.req.query(name);
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/**
 * `GET /r/:slug/sso/callback`: the provider sent the guest back. See the head of this file for the order.
 */
export async function handleSsoCallback(c: Context, deps: RegistrationSsoDeps): Promise<Response> {
  noStore(c);
  const slug = c.req.param("slug") ?? "";
  if (!EVENT_SLUG.test(slug)) return respondRegistrationNotFound(c);

  // Before anything that depends on the code: the browser must be the one that began this flow (login CSRF).
  const code = param(c, "code", MAX_CODE_CHARS);
  const state = param(c, "state", MAX_STATE_CHARS);
  if (code === null || state === null) return refuse(c, slug, "missing_code_or_state", "failed");
  if (!guestSsoFlowCookieMatches(c, state)) return refuse(c, slug, "flow_cookie_mismatch", "failed");

  try {
    return await finishSignIn(c, deps, slug, code, state);
  } catch (error) {
    return failed(c, slug, error);
  }
}

async function finishSignIn(c: Context, deps: RegistrationSsoDeps, slug: string, code: string, state: string): Promise<Response> {
  const { db } = deps;
  const target = await openSsoEvent(db, slug);
  if (!target) {
    clearGuestSsoFlowCookie(c, slug);
    return respondRegistrationNotFound(c);
  }
  const { eventId } = target;

  const spent = await spendGuestSsoState(db, state, new Date());
  if (spent === null) return refuse(c, slug, "state_invalid", "failed", eventId);
  if (spent.eventId !== eventId || spent.providerId !== target.access.providerId) {
    return refuse(c, slug, "state_mismatch", "failed", eventId);
  }
  const provider = await findOidcProviderById(db, spent.providerId);
  if (!provider?.enabled) return refuse(c, slug, "provider_unavailable", "failed", eventId);

  let baseUrl: string;
  try {
    baseUrl = await deps.baseUrl();
  } catch {
    return refuse(c, slug, "instance_url_missing", "failed", eventId);
  }
  let payload;
  try {
    ({ payload } = await exchangeAndValidateIdToken(
      provider,
      code,
      spent.codeVerifier,
      buildGuestSsoRedirectUri(baseUrl, slug),
      spent.nonce,
    ));
  } catch {
    // What the provider or the library said is not repeated: it can name a claim, an address or a client.
    return refuse(c, slug, "token_validation", "failed", eventId);
  }

  const identity = identityFromToken(payload, provider, target.access.restriction);
  if (!identity.ok) return refuse(c, slug, identity.reason, noticeFor(identity.reason), eventId);

  setGuestSsoSessionCookie(
    c,
    { eventId, slug, providerId: provider.id },
    { subject: identity.subject, email: identity.email, issuedAt: Date.now(), proof: identity.proof },
  );
  return backToPage(c, slug, null);
}
