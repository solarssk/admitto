/**
 * The routing by host (D-C6, PR 119b): the first middleware of the application after the access log. It names the host's kind
 * (./guest-host.ts) for the rest of the request, and on the verified own address of an event it lets through only what ./guest-paths.ts
 * lists; every other path, whatever the method, gets the one public 404 of the registration routes (no theme, no database), so the
 * panel, the staff's sign-in, the API and the health routes do not exist there, and a path that is hidden looks like a page that is
 * not there.
 *
 * - The host is `resolveRequestOrigin(c)`, which reads `X-Forwarded-Host` only from a trusted proxy and otherwise the host the request
 *   came to: no other place reads the `Host` header for this. A name that cannot be an address of an event (`localhost`, an IP
 *   address) and the host the configuration names as the instance's are never looked up.
 * - A host that is only a pending address, or no address, is served as before; the exception is the proof at
 *   `/.well-known/admitto-domain-check` ({@link handleDomainCheck}), which answers for any address that is set.
 * - `GET /` on a guest's address goes to `/r/<slug of the event, from the database>`: the target is never taken from the request.
 * - The application is the only owner of `Strict-Transport-Security` (the nginx of the compose stack adds none, D-L3). Every answer to
 *   an HTTPS request carries it, an error, a 404 and a file included: the one the route set stays, and an answer without one gets
 *   the default here. The responses of a guest's address do not carry `includeSubDomains`: the address belongs to the organisation's
 *   own domain, and a page of ours must not pin HTTPS for the rest of its tree.
 *
 * A failed lookup is an error (a 500 from the application's handler, naming no host), never a quiet fall-back to "not a guest's
 * address": the panel must not appear on an address that may be a guest's because the database was out for a moment.
 */
import type { Context, MiddlewareHandler } from "hono";
import { signDomainCheck } from "@admitto/crypto";
import { resolveRequestOrigin } from "../auth/same-origin-post.js";
import { isSecureRequest } from "../is-secure-request.js";
import { respondRegistrationNotFound } from "../registration-page-security.js";
import { NOT_A_GUEST_HOST, type GuestHost, type GuestHostResolver } from "./guest-host.js";
import { classifyGuestRequest } from "./guest-paths.js";

const GUEST_HOST_KEY = "guestHost";

export interface GuestHostDeps {
  resolver: GuestHostResolver;
  /** The host of the instance as the configuration gives it, or null (see `configuredInstanceHostname`). */
  configuredInstanceHostname: () => string | null;
}

/** What the middleware found for this request (`none` when it did not run, as in a unit test of one handler). */
export function guestHostOf(c: Context): GuestHost {
  return (c.get(GUEST_HOST_KEY) as GuestHost | undefined) ?? NOT_A_GUEST_HOST;
}

/**
 * Whether the request is on the own address of one event and `eventId` is another event: a ticket, a QR image, a map or a sign-in of
 * that other event is not served there (one address, one event). On every other host the answer is false.
 */
export function isOtherEventOnGuestHost(c: Context, eventId: string): boolean {
  const host = guestHostOf(c);
  return host.kind === "guest" && host.eventId !== eventId;
}

/** The host name of the request, lower case and without the root dot some clients add (`summit.acme.example.` is the same name in DNS and must not be a way round the routing). */
function hostnameOf(c: Context): string {
  const hostname = new URL(resolveRequestOrigin(c)).hostname.toLowerCase();
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

/** The header without `includeSubDomains`, or null when there is nothing to change. */
function withoutSubdomains(value: string | null): string | null {
  if (value === null) return null;
  const kept = value.split(";").filter((part) => part.trim().toLowerCase() !== "includesubdomains");
  return kept.join(";").trim();
}

const HSTS_DEFAULT = "max-age=31536000; includeSubDomains";

/** The header of a guest's address: whatever is set loses `includeSubDomains`; when none is set, an HTTPS answer gets the default without it. */
function guestHsts(headers: Headers, secure: boolean): string | null {
  return withoutSubdomains(headers.get("strict-transport-security") ?? (secure ? HSTS_DEFAULT : null));
}

/** The header of any other host: an HTTPS answer that has none gets the default (the instance pins its subdomains, as before). */
function ensureInstanceHsts(c: Context): void {
  if (isSecureRequest(c) && !c.res.headers.has("strict-transport-security")) c.header("Strict-Transport-Security", HSTS_DEFAULT);
}

/** The answer of the middleware itself for a request on a guest's address, or null to let the router answer. */
function answerFor(c: Context, host: Extract<GuestHost, { kind: "guest" }>): Response | null {
  const verdict = classifyGuestRequest(c.req.method, c.req.path, host.slug);
  if (verdict === "allow") return null;
  if (verdict === "deny") return respondRegistrationNotFound(c);
  const to = c.redirect(`/r/${encodeURIComponent(host.slug)}`, 302);
  to.headers.set("Cache-Control", "no-store");
  return to;
}

export function createGuestHostMiddleware(deps: GuestHostDeps): MiddlewareHandler {
  return async (c, next) => {
    const hostname = hostnameOf(c);
    const host = hostname === deps.configuredInstanceHostname() ? NOT_A_GUEST_HOST : await deps.resolver.resolve(hostname);
    c.set(GUEST_HOST_KEY, host);
    if (host.kind !== "guest") {
      await next();
      ensureInstanceHsts(c);
      return;
    }

    const answer = answerFor(c, host);
    if (answer) {
      const value = guestHsts(answer.headers, isSecureRequest(c));
      if (value !== null) answer.headers.set("Strict-Transport-Security", value);
      return answer;
    }
    await next();
    const pinned = guestHsts(c.res.headers, isSecureRequest(c));
    if (pinned !== null) c.header("Strict-Transport-Security", pinned);
  };
}

/**
 * `GET /.well-known/admitto-domain-check`: the proof that this address reaches this instance, for this event
 * (`{ "ok": true, "mac": signDomainCheck(eventId, address) }`). It answers for any address that is set, verified or not, because it is
 * what the check of the address needs before it can verify anything. On any other host it is the 404 of a path that is not there.
 * Nothing in it varies but the mac, and the mac says nothing of the key or the event.
 */
export function handleDomainCheck(c: Context): Response | Promise<Response> {
  const host = guestHostOf(c);
  if (host.kind === "none") return c.notFound();
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("X-Content-Type-Options", "nosniff");
  return c.json({ ok: true, mac: signDomainCheck(host.eventId, host.domain) });
}
