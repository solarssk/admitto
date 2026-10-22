/**
 * `GET /r/:slug`: the guest registration form for the event whose slug it is.
 *
 * Anonymous. Anything that is not an open form, an unknown slug, an event with registration off, an
 * archived one, one that offers another way in, one that is not ready, is the one 404 of the
 * registration routes, byte for byte (see `respondRegistrationNotFound`), and its theme is not even
 * looked up. An event that is over answers with the closed page.
 *
 * Only the public link is built here. An event whose access method is the password or the company
 * sign-in answers the same 404 until their PRs (111, 118) make this page ask for them. The submit
 * route (`POST /r/:slug`, PR 95c) is the other half of the contract in ./form-contract.ts.
 *
 * No cookie is read or set, and nothing the page shows depends on the query string.
 */
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import type { BrandingTheme } from "@admitto/auth";
import { recordSystemLog } from "@admitto/shared/system-log";
import { createAuthPageScriptNonce } from "../auth-page-security.js";
import { isSecureRequest } from "../is-secure-request.js";
import { getRegistrationPageSecurityHeaders, respondRegistrationNotFound } from "../registration-page-security.js";
import type { ClosedFormModel, RegistrationFormModel } from "./form-model.js";
import { loadRegistrationPage } from "./form-model.js";
import { renderRegistrationClosedPage, renderRegistrationFormPage } from "./form-page.js";

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

function respondForm(c: Context, form: RegistrationFormModel, theme: BrandingTheme | null): Response {
  // A fresh nonce for every response, so a script an attacker injected into one page could not
  // run in another.
  const nonce = createAuthPageScriptNonce();
  applyHeaders(
    c,
    getRegistrationPageSecurityHeaders(nonce, { turnstile: true, theme, logoUrl: form.event.logoUrl, secure: isSecureRequest(c) }),
  );
  return c.html(renderRegistrationFormPage(form, { nonce, theme }), 200);
}

function respondClosed(c: Context, page: ClosedFormModel, theme: BrandingTheme | null): Response {
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
  let state: Awaited<ReturnType<typeof loadRegistrationPage>>;
  try {
    state = await loadRegistrationPage(deps.db, c.req.param("slug") ?? "", new Date());
  } catch (err) {
    // The class of the failure only: an error message of the database can carry a value.
    console.error("loadRegistrationPage failed:", { reason: err instanceof Error ? err.name : "unknown" });
    recordSystemLog({ level: "error", source: "api", message: "registration_page_failed", fields: { route: "/r/:slug" } });
    return deps.serverError(c);
  }
  if (state.kind === "not_found") return respondRegistrationNotFound(c);
  const theme = await deps.loadTheme();
  return state.kind === "closed" ? respondClosed(c, state.page, theme) : respondForm(c, state.form, theme);
}
