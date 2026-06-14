import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  LOGIN_NEXT,
  login,
  logout,
  validateSession,
  validatePartialSession,
  completeMfa,
  startTotpEnrollment,
  confirmTotpEnrollment,
  promoteSessionToFull,
  SESSION_STAGE,
} from "@admitto/auth";
import { checkLoginEmailRateLimit } from "./login-rate-limit.js";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "./mfa-rate-limit.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { RateLimitStore } from "../rate-limit/types.js";

const AUTH_ERROR = { error: "unauthorized" } as const;

function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax";
  path: string;
} {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] !== "development",
    sameSite: "Lax",
    path: "/",
  };
}

/** Set httpOnly session cookie after successful login. */
export function setSessionCookie(c: Context, rawToken: string): void {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
}

/** Set httpOnly trusted-device cookie. */
export function setTrustedDeviceCookie(c: Context, rawToken: string): void {
  setCookie(c, TRUSTED_DEVICE_COOKIE_NAME, rawToken, sessionCookieOptions());
}

/** Clear session cookie (call after server-side revoke). */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

export function clearTrustedDeviceCookie(c: Context): void {
  deleteCookie(c, TRUSTED_DEVICE_COOKIE_NAME, { path: "/" });
}

/** POST /api/auth/login — rate-limited, sets session cookie on success. */
export async function handleLogin(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json(AUTH_ERROR, 401);
  }

  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return c.json(AUTH_ERROR, 401);
  }

  const trustedDeviceToken = getCookie(c, TRUSTED_DEVICE_COOKIE_NAME);

  const result = await login(
    db,
    {
      email,
      password,
      ip: resolveClientIp(c),
      userAgent: c.req.header("user-agent"),
      trustedDeviceToken,
    },
    { email },
  );

  if (!result.ok) {
    if (!(await checkLoginEmailRateLimit(rateLimitStore, email))) {
      return c.json({ error: "too many requests" }, 429);
    }
    return c.json(AUTH_ERROR, 401);
  }

  setSessionCookie(c, result.rawToken);
  return c.json({ ok: true, next: result.next }, 200);
}

/** POST /api/auth/logout — revokes current session and clears cookies. */
export async function handleLogout(c: Context, db: PrismaClient): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  const validated = rawToken ? await validatePartialSession(db, rawToken) : null;
  await logout(db, validated);
  clearSessionCookie(c);
  clearTrustedDeviceCookie(c);
  return c.json({ ok: true }, 200);
}

/** GET /api/auth/me — current user profile (requires full session). */
export async function handleMe(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      email: true,
      display_name: true,
      is_active: true,
      created_at: true,
    },
  });

  if (!user) {
    return c.json(AUTH_ERROR, 401);
  }

  const assignments = await db.roleAssignment.findMany({
    where: { user_id: auth.userId },
    select: {
      role: true,
      scope_type: true,
      scope_id: true,
    },
  });

  return c.json({ user, assignments }, 200);
}

/** POST /api/auth/mfa/verify — complete MFA step (partial session). */
export async function handleMfaVerify(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.MFA_PENDING) {
    return c.json(AUTH_ERROR, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json(AUTH_ERROR, 401);
  }

  const { code, remember_device: rememberDevice } = body as Record<string, unknown>;
  if (typeof code !== "string" || !code) {
    return c.json(AUTH_ERROR, 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip))) {
    return c.json({ error: "too many requests" }, 429);
  }

  const result = await completeMfa(db, {
    userId: partial.userId,
    sessionId: partial.sessionId,
    code,
    rememberDevice: rememberDevice === true || rememberDevice === "1",
    ip,
    userAgent: c.req.header("user-agent"),
  });

  if (!result.ok) {
    return c.json(AUTH_ERROR, 401);
  }

  if (result.trustedDeviceRawToken) {
    setTrustedDeviceCookie(c, result.trustedDeviceRawToken);
  }

  return c.json({ ok: true, next: LOGIN_NEXT.COMPLETE }, 200);
}

/** POST /api/auth/mfa/totp/enroll — start enrollment (partial session). */
export async function handleTotpEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");

  const enrollment = await startTotpEnrollment(db, partial.userId);
  if (!enrollment) {
    return c.json(AUTH_ERROR, 401);
  }

  return c.json(
    {
      ok: true,
      otpauth_uri: enrollment.otpauthUri,
      backup_codes: enrollment.backupCodes,
    },
    200,
  );
}

/** POST /api/auth/mfa/totp/confirm — confirm TOTP with code. */
export async function handleTotpConfirm(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json(AUTH_ERROR, 401);
  }

  const { code } = body as Record<string, unknown>;
  if (typeof code !== "string" || !code) {
    return c.json(AUTH_ERROR, 401);
  }

  const ok = await confirmTotpEnrollment(db, partial.userId, code);
  if (!ok) {
    return c.json(AUTH_ERROR, 401);
  }

  if (partial.stage === SESSION_STAGE.ENROLLMENT_REQUIRED) {
    await promoteSessionToFull(db, partial.sessionId, partial.userId);
  }

  return c.json({ ok: true, next: LOGIN_NEXT.COMPLETE }, 200);
}
