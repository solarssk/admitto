/**
 * `GET` and `POST /r/:slug/confirm/:token`: the link in the confirmation mail of a guest registration (D-C5). The mail is
 * the proof that the guest owns the address, and this route is where they give it.
 *
 * Anonymous, and the link is the credential. The token is `<registration id>.<signature>`; the signature
 * (`signRegistrationConfirm`) is made from a key only the server has, and only the mail of that registration carries
 * it. So everything the route may say or do rests on the signature, and it is checked first, before anything is read:
 *
 * - A token that is not shaped like one, or whose signature does not match, answers the one 404 of the registration
 *   routes, byte for byte, as an unknown event does. The signature is compared in constant time. A stranger who guesses
 *   links learns nothing, and costs no database read.
 * - `GET` shows a page with a button and changes nothing. Mail scanners, link previews and browsers that prefetch follow
 *   the links of a message, so opening a link cannot be what confirms.
 * - `POST` confirms. It is the form of that page, posting to its own address, guarded as the submit route is (the
 *   cross-site check, the limiter per client IP, a small body cap), and answers with the screen the result comes to
 *   (./confirm-page.ts). A second click, or a second request at the same time, finds the registration placed and says
 *   so, without an error and without a second mail.
 * - The event is looked up by the rules of its registration (`resolveConfirmation`), not of the form: a guest who holds a
 *   link is not turned away because the way in was switched off or a text unpublished meanwhile. What closes it is what
 *   closes the registration: registration off, an archived event (the one 404), an event that is over (the closed page).
 *   `confirmRegistrationAddress` judges the same again under its locks, with the clock read there.
 *
 * What the pages say about the registration is its state and no more (the link is the credential of the address), and
 * a link whose registration is gone, or older than 24 hours, is "expired" alike: which of the two it is depends on when
 * the clean-up last ran.
 *
 * There is no floor of time on the answers, unlike the submit route: only the holder of a link reaches the database, and
 * what is told is about their own registration. Nothing that identifies a guest is written to a log, and the token is not
 * in the access log (`redactRequestPath`).
 */
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { BrandingTheme } from "@admitto/auth";
import { verifyRegistrationConfirm } from "@admitto/crypto";
import type { PrismaClient } from "@admitto/db";
import { recordSystemLog } from "@admitto/shared/system-log";
import { confirmRegistrationAddress, type ConfirmRegistrationResult, type PublicWriteOptions } from "@admitto/tickets";
import { applyAuthPageSecurityHeaders, createAuthPageScriptNonce } from "../auth-page-security.js";
import { createCrossSitePostGuard } from "../auth/same-origin-post.js";
import { isSecureRequest } from "../is-secure-request.js";
import { rateLimit } from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { getRegistrationPageSecurityHeaders, respondRegistrationNotFound } from "../registration-page-security.js";
import { renderConfirmPage, type ConfirmScreen } from "./confirm-page.js";
import { respondClosed } from "./form-routes.js";
import { resolveConfirmation, type ResolvedConfirmation } from "./form-model.js";
import { RETRY_AFTER_SECONDS, prismaCode } from "./submit-route.js";

/** The form of the confirmation page has no field, so its POST has no body worth reading. The cap is for the request that
 * sends one anyway. */
export const MAX_CONFIRM_BODY_BYTES = 1024;

/** What an id or a signature in a link is made of (an id from the database, a signature in base64url). The length of the
 * signature is `verifyRegistrationConfirm`'s to judge, as it is the one that knows it. */
const LINK_PART = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The first steps of `POST /r/:slug/confirm/:token`, in the order of the submit route's (./submit-guards.ts): the
 * cross-site check (a form post of the page carries its own origin), the limiter per client IP, the body cap.
 */
export function registrationConfirmGuards(
  store: RateLimitStore,
): [MiddlewareHandler, MiddlewareHandler, MiddlewareHandler] {
  return [
    createCrossSitePostGuard({ format: "text" }),
    rateLimit(store, "registration:confirm"),
    bodyLimit({ maxSize: MAX_CONFIRM_BODY_BYTES, onError: (c) => c.json({ error: "request too large" }, 413) }),
  ];
}

export interface RegistrationConfirmDeps {
  db: PrismaClient;
  /** The instance branding. Called only once a page is going to be shown. */
  loadTheme: () => Promise<BrandingTheme | null>;
  /** The answer for a failure of the route itself (the database cannot be read). */
  serverError: (c: Context) => Response | Promise<Response>;
  /** Test only: how long a write waits for a lock, and how many may try at once. */
  placement?: PublicWriteOptions;
}

/**
 * The id of the registration a link names, when the link is signed for it; null otherwise, whatever is wrong with it.
 * The token is `<id>.<signature>` with exactly one dot.
 */
export function readConfirmationLink(token: string): string | null {
  const dot = token.indexOf(".");
  if (dot < 0 || dot !== token.lastIndexOf(".")) return null;
  const registrationId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!LINK_PART.test(registrationId) || !LINK_PART.test(signature)) return null;
  return verifyRegistrationConfirm(registrationId, signature) ? registrationId : null;
}

type OpenConfirmation = Extract<ResolvedConfirmation, { kind: "open" }>;

/** A screen as the answer: the headers of the registration pages (nothing is cached, nothing is sent to another
 * origin, and no script may run), a fresh nonce for the policy, and the status. A 503 tells the guest when to try again. */
function respondScreen(
  c: Context,
  screen: ConfirmScreen,
  target: OpenConfirmation,
  theme: BrandingTheme | null,
  status: 200 | 503 = 200,
): Response {
  applyAuthPageSecurityHeaders(
    c,
    getRegistrationPageSecurityHeaders(createAuthPageScriptNonce(), {
      turnstile: false,
      theme,
      logoUrl: target.event.logoUrl,
      secure: isSecureRequest(c),
    }),
  );
  if (status === 503) c.header("Retry-After", RETRY_AFTER_SECONDS);
  return c.html(renderConfirmPage(screen, { event: target.event, contact: target.contact }, theme), status);
}

/** What the button's answer is: the screen of the result, or the 404 of a registration route when the event closed
 * while the request ran (the clock and the state are read again under the locks). */
function answer(
  c: Context,
  result: ConfirmRegistrationResult,
  target: OpenConfirmation,
  theme: BrandingTheme | null,
): Response {
  switch (result.outcome) {
    case "placed":
      return respondScreen(c, { kind: "placed", status: result.status }, target, theme);
    case "already_placed":
      return respondScreen(c, { kind: "already" }, target, theme);
    case "expired":
    case "gone":
      return respondScreen(c, { kind: "expired" }, target, theme);
    case "already_registered":
      return respondScreen(c, { kind: "registered" }, target, theme);
    case "full":
      return respondScreen(c, { kind: "full" }, target, theme);
    case "busy":
      return respondScreen(c, { kind: "busy" }, target, theme, 503);
    case "closed":
      return respondRegistrationNotFound(c);
  }
}

/** Both methods: the link, the event, and then either the page (`GET`) or the confirmation (`POST`). */
async function handle(c: Context, deps: RegistrationConfirmDeps, confirm: boolean): Promise<Response> {
  const registrationId = readConfirmationLink(c.req.param("token") ?? "");
  if (registrationId === null) return respondRegistrationNotFound(c);

  const target = await resolveConfirmation(deps.db, c.req.param("slug") ?? "", new Date());
  if (target.kind === "not_found") return respondRegistrationNotFound(c);
  const theme = await deps.loadTheme();
  if (target.kind === "closed") return respondClosed(c, target.page, theme);
  if (!confirm) return respondScreen(c, { kind: "ask" }, target, theme);

  const result = await confirmRegistrationAddress(deps.db, { eventId: target.eventId, registrationId }, deps.placement);
  return answer(c, result, target, theme);
}

/** A failure nobody expected. Only the class of the error is logged: the message of a database error can carry a value,
 * and the path carries the link. */
function answerFailure(c: Context, deps: RegistrationConfirmDeps, error: unknown): Response | Promise<Response> {
  const code = prismaCode(error);
  // The event was deleted while the request ran: as if it had never been there.
  if (code === "P2003") return respondRegistrationNotFound(c);
  console.error("registration confirm failed:", { reason: error instanceof Error ? error.name : "unknown", code });
  recordSystemLog({
    level: "error",
    source: "api",
    message: "registration_confirm_failed",
    fields: { route: "/r/:slug/confirm/:token" },
  });
  return deps.serverError(c);
}

async function run(c: Context, deps: RegistrationConfirmDeps, confirm: boolean): Promise<Response> {
  try {
    return await handle(c, deps, confirm);
  } catch (error) {
    return answerFailure(c, deps, error);
  }
}

/** `GET`: the page with the button. Reads, and writes nothing. */
export function handleGetConfirmation(c: Context, deps: RegistrationConfirmDeps): Promise<Response> {
  return run(c, deps, false);
}

/** `POST`: confirms the address and answers with what became of the registration. */
export function handlePostConfirmation(c: Context, deps: RegistrationConfirmDeps): Promise<Response> {
  return run(c, deps, true);
}
