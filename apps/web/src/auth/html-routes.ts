import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  LOGIN_NEXT,
  login,
  logout,
  revokeSession,
  validateSession,
  validatePartialSession,
} from "@admitto/auth";
import { getCookie } from "hono/cookie";
import { checkLoginEmailRateLimit } from "./login-rate-limit.js";
import { setSessionCookie, clearSessionCookie } from "./routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import {
  getLoginPageSecurityHeaders,
  renderLoginForm,
  LOGIN_ERROR_CODE,
} from "../login-page.js";
import { createAuthPageScriptNonce } from "../auth-page-security.js";
import { resolveOptionalSafeRedirectPath } from "./safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { resolveStaffEntryPath } from "../setup-routes.js";
import { loadLoginSsoProviders } from "./login-sso.js";

function mfaPathWithNext(path: string, next?: string): string {
  if (!next) return path;
  return `${path}?next=${encodeURIComponent(next)}`;
}

const LOGIN_ERROR = LOGIN_ERROR_CODE;

function htmlResponse(c: Context, html: string, scriptNonce: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getLoginPageSecurityHeaders(scriptNonce))) {
    c.header(name, value);
  }
  return c.html(html, status);
}

/** GET /login — operator sign-in form (HTML). */
export async function handleGetLogin(c: Context, db: PrismaClient): Promise<Response> {
  if (await resolveStaffEntryPath(db) === "/setup") {
    return c.redirect("/setup", 302);
  }
  // If user already has a valid session, redirect them to their landing page
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  if (rawToken) {
    const validated = await validateSession(db, rawToken);
    if (validated) {
      const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
      try {
        const landing = await resolvePostLoginRedirectForUser(db, validated.userId, next ?? undefined);
        return c.redirect(landing, 302);
      } catch {
        // fall through to show login form
      }
    }
  }
  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  const errorParam = c.req.query("error") ?? undefined;
  const sso = await loadLoginSsoProviders(db);
  const scriptNonce = createAuthPageScriptNonce();
  return htmlResponse(c, renderLoginForm(scriptNonce, errorParam, next, sso), scriptNonce);
}

async function parseLoginForm(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  return {};
}

/** POST /login — form login, sets session cookie, redirects to `/operator`. */
export async function handlePostLogin(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  if (await resolveStaffEntryPath(db) === "/setup") {
    return c.redirect("/setup", 302);
  }
  const form = await parseLoginForm(c);
  const email = form["email"]?.trim() ?? "";
  const password = form["password"] ?? "";
  const rawNext = form["next"] ?? c.req.query("next");
  const next = resolveOptionalSafeRedirectPath(rawNext);
  const sso = await loadLoginSsoProviders(db);

  if (!email || !password) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderLoginForm(scriptNonce, LOGIN_ERROR, next, sso), scriptNonce, 401);
  }

  const result = await login(
    db,
    {
      email,
      password,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
      trustedDeviceToken: getCookie(c, TRUSTED_DEVICE_COOKIE_NAME),
    },
    { email },
  );

  if (!result.ok) {
    if (!(await checkLoginEmailRateLimit(rateLimitStore, email, resolveClientIp(c)))) {
      return c.text("Too many requests", 429);
    }
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderLoginForm(scriptNonce, LOGIN_ERROR, next, sso), scriptNonce, 401);
  }

  setSessionCookie(c, result.rawToken);

  if (result.next === LOGIN_NEXT.MFA_REQUIRED) {
    return c.redirect(mfaPathWithNext("/mfa/verify", next), 302);
  }
  if (result.next === LOGIN_NEXT.ENROLLMENT_REQUIRED) {
    return c.redirect(mfaPathWithNext("/mfa/enroll", next), 302);
  }
  if (result.next === LOGIN_NEXT.CHANGE_PASSWORD) {
    return c.redirect("/change-password", 302);
  }

  let landing: string;
  try {
    landing = await resolvePostLoginRedirectForUser(db, result.userId, form["next"] ?? c.req.query("next"));
  } catch (err) {
    await revokeSession(db, result.sessionId);
    clearSessionCookie(c);
    console.error("post-login redirect:", err instanceof Error ? err.message : "unknown");
    return c.redirect("/login", 302);
  }
  return c.redirect(landing, 302);
}

/** POST /logout — revokes session and redirects to `/login`. Trusted device is preserved so
 * the user won't be asked for 2FA again on the same device within the trust window. */
export async function handlePostLogout(c: Context, db: PrismaClient): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  const validated = rawToken ? await validatePartialSession(db, rawToken) : null;
  await logout(db, validated, { ip: resolveClientIp(c) });
  clearSessionCookie(c);
  return c.redirect("/login", 302);
}
