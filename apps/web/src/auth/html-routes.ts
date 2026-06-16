import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  LOGIN_NEXT,
  login,
  logout,
  validatePartialSession,
  revokeTrustedDeviceByToken,
} from "@admitto/auth";
import { getCookie } from "hono/cookie";
import { checkLoginEmailRateLimit } from "./login-rate-limit.js";
import { setSessionCookie, clearSessionCookie, clearTrustedDeviceCookie } from "./routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import {
  getLoginPageSecurityHeaders,
  renderLoginForm,
  LOGIN_ERROR_CODE,
} from "../login-page.js";
import { resolveSafeRedirectPath } from "./safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { loadLoginSsoProviders } from "./login-sso.js";

function mfaPathWithNext(path: string, next: string): string {
  return `${path}?next=${encodeURIComponent(next)}`;
}

const LOGIN_ERROR = LOGIN_ERROR_CODE;

function htmlResponse(c: Context, html: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getLoginPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

/** GET /login — operator sign-in form (HTML). */
export async function handleGetLogin(c: Context, db: PrismaClient): Promise<Response> {
  const next = resolveSafeRedirectPath(c.req.query("next"));
  const errorParam = c.req.query("error") ?? undefined;
  const sso = await loadLoginSsoProviders(db);
  return htmlResponse(c, renderLoginForm(errorParam, next, sso));
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
  const form = await parseLoginForm(c);
  const email = form["email"]?.trim() ?? "";
  const password = form["password"] ?? "";
  const deviceLabel = form["device_label"]?.trim();
  const next = resolveSafeRedirectPath(form["next"] ?? c.req.query("next"));
  const sso = await loadLoginSsoProviders(db);

  if (!email || !password) {
    return htmlResponse(c, renderLoginForm(LOGIN_ERROR, next, sso), 401);
  }

  const result = await login(
    db,
    {
      email,
      password,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
      deviceLabel: deviceLabel || undefined,
      trustedDeviceToken: getCookie(c, TRUSTED_DEVICE_COOKIE_NAME),
    },
    { email },
  );

  if (!result.ok) {
    if (!(await checkLoginEmailRateLimit(rateLimitStore, email))) {
      return c.text("Too many requests", 429);
    }
    return htmlResponse(c, renderLoginForm(LOGIN_ERROR, next, sso), 401);
  }

  setSessionCookie(c, result.rawToken);

  if (result.next === LOGIN_NEXT.MFA_REQUIRED) {
    return c.redirect(mfaPathWithNext("/mfa/verify", next), 302);
  }
  if (result.next === LOGIN_NEXT.ENROLLMENT_REQUIRED) {
    return c.redirect(mfaPathWithNext("/mfa/enroll", next), 302);
  }
  const landing = await resolvePostLoginRedirectForUser(db, result.userId, form["next"] ?? c.req.query("next"));
  return c.redirect(landing, 302);
}

/** POST /logout — revokes session, trusted device, and redirects to `/login`. */
export async function handlePostLogout(c: Context, db: PrismaClient): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  const trustedRaw = getCookie(c, TRUSTED_DEVICE_COOKIE_NAME);
  const validated = rawToken ? await validatePartialSession(db, rawToken) : null;
  if (validated) {
    await revokeTrustedDeviceByToken(db, validated.userId, trustedRaw);
  }
  await logout(db, validated);
  clearSessionCookie(c);
  clearTrustedDeviceCookie(c);
  return c.redirect("/login", 302);
}
