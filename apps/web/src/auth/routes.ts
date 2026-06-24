import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { PrismaClient } from "@prisma/client";
import { describeMailConfigForOrg } from "@admitto/mailer-config";
import { resolveInstanceOrganizationId } from "../admin/instance-org.js";
import {
  SESSION_COOKIE_NAME,
  TRUSTED_DEVICE_COOKIE_NAME,
  LOGIN_NEXT,
  login,
  logout,
  validateSession,
  validatePartialSession,
  completeMfa,
  getOrStartTotpEnrollment,
  confirmTotpEnrollment,
  promoteSessionToFull,
  promoteSessionToBackupCodesStep,
  getTrustedDeviceDays,
  revokeTrustedDeviceByToken,
  SESSION_STAGE,
  updateSessionDeviceLabel,
  DEVICE_LABEL_MAX_LEN,
  regenerateBackupRecoveryCodes,
  resolveSetupComplete,
  canManageInstance,
} from "@admitto/auth";
import { checkLoginEmailRateLimit } from "./login-rate-limit.js";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "./mfa-rate-limit.js";
import {
  getStashedEnrollmentBackupCodes,
  stashEnrollmentBackupCodes,
  extendEnrollmentBackupCodes,
  clearEnrollmentBackupCodes,
} from "./enrollment-backup-cache.js";
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

/** Set httpOnly trusted-device cookie with TTL from system settings. */
export async function setTrustedDeviceCookie(
  c: Context,
  db: PrismaClient,
  rawToken: string,
): Promise<void> {
  const days = await getTrustedDeviceDays(db);
  if (days === 0) return;
  setCookie(c, TRUSTED_DEVICE_COOKIE_NAME, rawToken, {
    ...sessionCookieOptions(),
    maxAge: days * 24 * 60 * 60,
  });
}

/** Clear session cookie (call after server-side revoke). */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

/** Clear trusted-device cookie (call on logout). */
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
    if (!(await checkLoginEmailRateLimit(rateLimitStore, email, resolveClientIp(c)))) {
      return c.json({ error: "too many requests" }, 429);
    }
    return c.json(AUTH_ERROR, 401);
  }

  setSessionCookie(c, result.rawToken);
  return c.json({ ok: true, next: result.next }, 200);
}

/** POST /api/auth/logout — revokes current session, trusted device, and clears cookies. */
export async function handleLogout(c: Context, db: PrismaClient): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  const trustedRaw = getCookie(c, TRUSTED_DEVICE_COOKIE_NAME);
  const validated = rawToken ? await validatePartialSession(db, rawToken) : null;
  if (validated) {
    await revokeTrustedDeviceByToken(db, validated.userId, trustedRaw);
  }
  await logout(db, validated, { ip: resolveClientIp(c) });
  clearSessionCookie(c);
  clearTrustedDeviceCookie(c);
  return c.json({ ok: true }, 200);
}

export type MailerStatusPayload = {
  configured: boolean;
  provider: "smtp" | "graph" | "powerautomate" | "export_only" | null;
};

export interface HandleMeOptions {
  /** When true (`/api/admin/me` only), resolve org mail transport presence — no credentials. */
  includeMailerStatus?: boolean;
  /** When true, always include first-run onboarding completion flag (also auto-included for instance superadmins on `/api/auth/me`). */
  includeSetupComplete?: boolean;
}

const MAILER_PROVIDERS = ["smtp", "graph", "powerautomate", "export_only"] as const;

function toMailerProvider(value: string | null): MailerStatusPayload["provider"] {
  if (!value) return null;
  return (MAILER_PROVIDERS as readonly string[]).includes(value)
    ? (value as MailerStatusPayload["provider"])
    : null;
}

async function resolveMailerStatus(db: PrismaClient): Promise<MailerStatusPayload> {
  const orgId = await resolveInstanceOrganizationId(db, process.env);
  const desc = await describeMailConfigForOrg(orgId, db, process.env);
  const provider = toMailerProvider(desc.provider.value);
  const configured = provider !== null;
  return { configured, provider };
}

/** GET /api/auth/me — current user profile (requires full session). */
export async function handleMe(
  c: Context,
  db: PrismaClient,
  opts?: HandleMeOptions,
): Promise<Response> {
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

  let device_label: string | null = null;
  if (auth.sessionId) {
    const session = await db.session.findUnique({
      where: { id: auth.sessionId },
      select: { device_label: true },
    });
    device_label = session?.device_label ?? null;
  }

  const body: {
    user: NonNullable<typeof user>;
    assignments: typeof assignments;
    device_label: string | null;
    session_active: boolean;
    mailer_status?: MailerStatusPayload;
    setup_complete?: boolean;
  } = {
    user,
    assignments,
    device_label,
    session_active: !!auth.sessionId,
  };

  if (opts?.includeMailerStatus) {
    body.mailer_status = await resolveMailerStatus(db);
  }

  if (opts?.includeSetupComplete || (await canManageInstance(db, auth.userId))) {
    body.setup_complete = await resolveSetupComplete(db);
  }

  return c.json(body, 200);
}

/** POST /api/auth/session/device-label — set optional tablet label on the current session. */
export async function handlePostSessionDeviceLabel(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!auth?.sessionId) {
    return c.json(AUTH_ERROR, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const raw =
    body && typeof body === "object" && "device_label" in body
      ? (body as { device_label?: unknown }).device_label
      : undefined;

  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return c.json({ error: "invalid_device_label" }, 400);
  }

  const label = typeof raw === "string" ? raw.trim() : "";
  if (label.length > DEVICE_LABEL_MAX_LEN) {
    return c.json({ error: "device_label_too_long" }, 400);
  }

  const ok = await updateSessionDeviceLabel(
    db,
    auth.sessionId,
    auth.userId,
    label.length > 0 ? label : null,
  );
  if (!ok) {
    return c.json(AUTH_ERROR, 401);
  }

  return c.json({ device_label: label.length > 0 ? label : null }, 200);
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
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip, code))) {
    return c.json({ error: "too many requests" }, 429);
  }

  const result = await completeMfa(
    db,
    {
      userId: partial.userId,
      sessionId: partial.sessionId,
      code,
      rememberDevice: rememberDevice === true || rememberDevice === "1",
      ip,
      userAgent: c.req.header("user-agent"),
    },
    { userId: partial.userId, sessionId: partial.sessionId, ip, userAgent: c.req.header("user-agent") },
  );

  if (!result.ok) {
    return c.json(AUTH_ERROR, 401);
  }

  if (result.trustedDeviceRawToken) {
    await setTrustedDeviceCookie(c, db, result.trustedDeviceRawToken);
  }

  return c.json({ ok: true, next: LOGIN_NEXT.COMPLETE }, 200);
}

/** POST /api/auth/mfa/totp/enroll — start enrollment (enrollment_required only). */
export async function handleTotpEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.json(AUTH_ERROR, 401);
  }

  const enrollment = await getOrStartTotpEnrollment(db, partial.userId);
  if (!enrollment) {
    return c.json(AUTH_ERROR, 401);
  }

  if (enrollment.backupCodes.length > 0) {
    stashEnrollmentBackupCodes(partial.sessionId, enrollment.backupCodes);
  }

  return c.json(
    {
      ok: true,
      otpauth_uri: enrollment.otpauthUri,
    },
    200,
  );
}

/** POST /api/auth/mfa/totp/confirm — confirm TOTP with code (enrollment_required only). */
export async function handleTotpConfirm(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
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

  const { code } = body as Record<string, unknown>;
  if (typeof code !== "string" || !code) {
    return c.json(AUTH_ERROR, 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip, code))) {
    return c.json({ error: "too many requests" }, 429);
  }

  const ok = await confirmTotpEnrollment(db, partial.userId, code);
  if (!ok) {
    return c.json(AUTH_ERROR, 401);
  }

  // Ensure backup codes are in the stash before promoting. They may be absent
  // when the QR step ran on a different instance or the original stash expired.
  if (!getStashedEnrollmentBackupCodes(partial.sessionId)) {
    const { codes } = await regenerateBackupRecoveryCodes(db, partial.userId);
    stashEnrollmentBackupCodes(partial.sessionId, codes);
  }

  const promoted = await promoteSessionToBackupCodesStep(db, partial.sessionId, partial.userId);
  if (!promoted) {
    return c.json(AUTH_ERROR, 401);
  }

  // Extend stash TTL to match the fresh backup-codes session window.
  extendEnrollmentBackupCodes(partial.sessionId);

  const backupCodes = getStashedEnrollmentBackupCodes(partial.sessionId) ?? [];

  return c.json(
    {
      ok: true,
      next: LOGIN_NEXT.BACKUP_CODES_REQUIRED,
      backup_codes: backupCodes,
    },
    200,
  );
}

/** POST /api/auth/mfa/totp/backup-codes/complete — finish enrollment after saving backup codes. */
export async function handleTotpBackupCodesComplete(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.BACKUP_CODES_REQUIRED) {
    return c.json(AUTH_ERROR, 401);
  }

  // Refuse completion when backup codes are not in the stash — completing here
  // would silently enter the app without the user ever seeing their recovery codes.
  const stashed = getStashedEnrollmentBackupCodes(partial.sessionId);
  if (!stashed?.length) {
    return c.json(
      { error: "Backup codes are no longer available. Log in again to restart enrollment." },
      401,
    );
  }

  const promoted = await promoteSessionToFull(db, partial.sessionId, partial.userId);
  if (!promoted) {
    return c.json(AUTH_ERROR, 401);
  }

  clearEnrollmentBackupCodes(partial.sessionId);
  return c.json({ ok: true, next: LOGIN_NEXT.COMPLETE }, 200);
}
