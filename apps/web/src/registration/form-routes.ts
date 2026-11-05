/**
 * `GET /r/:slug`: the guest registration form for the event whose slug it is.
 *
 * Anonymous. Anything that is not an open form, an unknown slug, an event with registration off, an
 * archived one, one that offers another way in, one that is not ready, is the one 404 of the
 * registration routes, byte for byte (see `respondRegistrationNotFound`), and its theme is not even
 * looked up. An event that is over answers with the closed page.
 *
 * The public link, the password of the event and the company sign-in are built here. An event whose way in is the password
 * asks for it first, on a screen of the page (see ./form-page.ts), and is the 404 while it has no password. An event whose way
 * in is the company sign-in (D-C4) shows a sign-in button to a guest who has not signed in and the form to one who has, and is
 * the 404 while no identity provider is chosen for guests or the chosen one is off. The submit route (`POST /r/:slug`, PR 95c)
 * is the other half of the contract in ./form-contract.ts.
 *
 * The company sign-in is the one thing that reads a cookie: the signed cookie of the sign-in (./sso-session.ts), only for an
 * event whose way in is the company sign-in, and only to learn whether the guest has signed in and with which address. A
 * cookie that does not check out is no cookie. Nothing else the page shows depends on a cookie or on the query string, except
 * one word of the query (`?sso=`) that a refused sign-in comes back with, which is mapped to a sentence of the page's own and
 * never printed.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import type { BrandingTheme } from "@admitto/auth";
import { recordSystemLog } from "@admitto/shared/system-log";
import { createAuthPageScriptNonce } from "../auth-page-security.js";
import { isSecureRequest } from "../is-secure-request.js";
import { getRegistrationPageSecurityHeaders, respondRegistrationNotFound } from "../registration-page-security.js";
import type { ClosedFormModel, ResolvedRegistration } from "./form-model.js";
import { resolveRegistration } from "./form-model.js";
import { renderRegistrationClosedPage, renderRegistrationFormPage, type SsoPageState } from "./form-page.js";
import { noticeFromQuery } from "./sso-identity.js";
import { proofSatisfies } from "./sso-claim.js";
import { readGuestSsoSession } from "./sso-session.js";

export interface RegistrationFormDeps {
  db: PrismaClient;
  /** The instance branding. Called only once the page is going to be shown. */
  loadTheme: () => Promise<BrandingTheme | null>;
  /** The answer for a failure of the page itself (the database cannot be read). */
  serverError: (c: Context) => Response | Promise<Response>;
}

function applyHeaders(c: Context, headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) c.header(name, value);
}

type OpenRegistration = Extract<ResolvedRegistration, { kind: "open" }>;

/**
 * Where the guest stands on an event whose way in is the company sign-in, or undefined for any other event. Signed in only
 * with a cookie that checks out for this event, this slug and the provider chosen now, and that the event's restriction as it is
 * now still lets in (a restriction an organiser tightens does not wait for a sign-in to run out).
 */
function ssoStateOf(c: Context, open: OpenRegistration): SsoPageState | undefined {
  const { access } = open;
  if (access.method !== "sso") return undefined;
  const identity = readGuestSsoSession(
    c,
    { eventId: open.eventId, slug: open.form.event.slug, providerId: access.providerId },
    Date.now(),
  );
  if (identity !== null && proofSatisfies(access.restriction, identity.proof)) return { signedInAs: identity.email };
  return { signedInAs: null, notice: noticeFromQuery(c.req.query("sso")) };
}

function respondForm(c: Context, open: OpenRegistration, theme: BrandingTheme | null): Response {
  const { form } = open;
  // A fresh nonce for every response, so a script an attacker injected into one page could not
  // run in another.
  const nonce = createAuthPageScriptNonce();
  const sso = ssoStateOf(c, open);
  // The Turnstile widget, its script and its frame only where the page has the widget: the company sign-in has none.
  applyHeaders(
    c,
    getRegistrationPageSecurityHeaders(nonce, { turnstile: !form.needsSso, theme, logoUrl: form.event.logoUrl, secure: isSecureRequest(c) }),
  );
  return c.html(renderRegistrationFormPage(form, { nonce, theme, ...(sso ? { sso } : {}) }), 200);
}

/** The page of an event that is over, which the confirmation of an address answers too (./confirm-route.ts). */
export function respondClosed(c: Context, page: ClosedFormModel, theme: BrandingTheme | null): Response {
  applyHeaders(
    c,
    getRegistrationPageSecurityHeaders(createAuthPageScriptNonce(), {
      turnstile: false,
      theme,
      logoUrl: page.event.logoUrl,
      secure: isSecureRequest(c),
    }),
  );
  return c.html(renderRegistrationClosedPage(page, theme), 200);
}

export async function handleGetRegistrationForm(c: Context, deps: RegistrationFormDeps): Promise<Response> {
  let state: ResolvedRegistration;
  try {
    state = await resolveRegistration(deps.db, c.req.param("slug") ?? "", new Date());
  } catch (err) {
    // The class of the failure only: an error message of the database can carry a value.
    console.error("loadRegistrationPage failed:", { reason: err instanceof Error ? err.name : "unknown" });
    recordSystemLog({ level: "error", source: "api", message: "registration_page_failed", fields: { route: "/r/:slug" } });
    return deps.serverError(c);
  }
  if (state.kind === "not_found") return respondRegistrationNotFound(c);
  const theme = await deps.loadTheme();
  return state.kind === "closed" ? respondClosed(c, state.page, theme) : respondForm(c, state, theme);
}
