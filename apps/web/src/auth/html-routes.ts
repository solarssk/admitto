import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  LOGIN_NEXT,
  login,
  logout,
  validatePartialSession,
} from "@admitto/auth";
import { getCookie } from "hono/cookie";
import { checkLoginEmailRateLimit } from "./login-rate-limit.js";
import { setSessionCookie, clearSessionCookie, clearTrustedDeviceCookie } from "./routes.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import {
  getLoginPageSecurityHeaders,
  renderLoginForm,
  renderOperatorLanding,
} from "../login-page.js";

const LOGIN_ERROR = "Invalid email or password.";

function htmlResponse(c: Context, html: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getLoginPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

/** GET /login — operator sign-in form (HTML). */
export function handleGetLogin(c: Context): Response {
  return htmlResponse(c, renderLoginForm());
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

  if (!email || !password) {
    return htmlResponse(c, renderLoginForm(LOGIN_ERROR), 401);
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
    return htmlResponse(c, renderLoginForm(LOGIN_ERROR), 401);
  }

  setSessionCookie(c, result.rawToken);

  if (result.next === LOGIN_NEXT.MFA_REQUIRED) {
    return c.redirect("/mfa/verify", 302);
  }
  if (result.next === LOGIN_NEXT.ENROLLMENT_REQUIRED) {
    return c.redirect("/mfa/enroll", 302);
  }
  return c.redirect("/operator", 302);
}

/** GET /operator — temporary landing after login (requires session). */
export async function handleGetOperator(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: { email: true },
  });
  if (!user) {
    return c.redirect("/login", 302);
  }

  const assignments = await db.roleAssignment.findMany({
    where: { user_id: auth.userId },
    select: { role: true, scope_type: true, scope_id: true },
  });

  const eventIds = new Set<string>();
  let allEvents = false;

  for (const a of assignments) {
    if (a.role === "superadmin" && a.scope_type === "instance") {
      allEvents = true;
      break;
    }
    if (a.role === "admin" && a.scope_type === "organization" && a.scope_id) {
      const orgEvents = await db.event.findMany({
        where: { organization_id: a.scope_id },
        select: { id: true },
      });
      for (const e of orgEvents) eventIds.add(e.id);
    }
    if (a.scope_type === "event" && a.scope_id) {
      eventIds.add(a.scope_id);
    }
  }

  const events = allEvents
    ? await db.event.findMany({
        select: { title: true, slug: true },
        orderBy: { date: "asc" },
      })
    : eventIds.size > 0
      ? await db.event.findMany({
          where: { id: { in: [...eventIds] } },
          select: { title: true, slug: true },
          orderBy: { date: "asc" },
        })
      : [];

  return htmlResponse(c, renderOperatorLanding(user.email, events));
}

/** POST /logout — revokes session server-side and redirects to `/login`. */
export async function handlePostLogout(c: Context, db: PrismaClient): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  const validated = rawToken ? await validatePartialSession(db, rawToken) : null;
  await logout(db, validated);
  clearSessionCookie(c);
  clearTrustedDeviceCookie(c);
  return c.redirect("/login", 302);
}
