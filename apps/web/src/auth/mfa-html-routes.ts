import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import type { StartTotpEnrollmentResult } from "@admitto/auth";
import {
  SESSION_STAGE,
  resumePendingTotpEnrollment,
  startTotpEnrollment,
  confirmTotpEnrollment,
  promoteSessionToFull,
  completeMfa,
  revokeSession,
  BACKUP_RECOVERY_CODE_COUNT,
  findBackupRecoveryRowId,
} from "@admitto/auth";
import {
  getMfaPageSecurityHeaders,
  renderMfaVerifyForm,
  renderMfaEnrollPage,
  renderMfaEnrollStartPage,
} from "../mfa-page.js";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "./mfa-rate-limit.js";
import {
  clearEnrollmentBackupCodes,
  getStashedEnrollmentBackupCodes,
  stashEnrollmentBackupCodes,
} from "./enrollment-backup-cache.js";
import { resolveOptionalSafeRedirectPath } from "./safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { setTrustedDeviceCookie, clearSessionCookie } from "./routes.js";
import type { RateLimitStore } from "../rate-limit/types.js";

function htmlResponse(c: Context, html: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getMfaPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

async function parseForm(c: Context): Promise<Record<string, string>> {
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

async function parseFormCodes(c: Context): Promise<string[]> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return [];
  }
  const raw = await c.req.text();
  return new URLSearchParams(raw)
    .getAll("code")
    .map((v) => v.trim())
    .filter(Boolean);
}


const MFA_ERROR = "Invalid code. Try again.";

/** Re-show stashed backup codes while enrollment is still pending on this session. */
function enrichEnrollmentForSession(
  sessionId: string,
  enrollment: StartTotpEnrollmentResult | null,
): StartTotpEnrollmentResult | null {
  if (!enrollment) return null;

  if (enrollment.backupCodes.length > 0) {
    stashEnrollmentBackupCodes(sessionId, enrollment.backupCodes);
    return enrollment;
  }

  const stashed = getStashedEnrollmentBackupCodes(sessionId);
  if (stashed?.length && enrollment.backupCodesAlreadyShown) {
    return {
      ...enrollment,
      backupCodes: stashed,
      backupCodesAlreadyShown: false,
    };
  }

  return enrollment;
}

/** Build enrollment HTML from current DB enrollment state. */
function renderEnrollFromState(
  sessionId: string,
  enrollment: StartTotpEnrollmentResult | null,
  error?: string,
  next?: string,
): string {
  const state = enrichEnrollmentForSession(sessionId, enrollment);
  if (!state) {
    return renderMfaEnrollPage("", [], error, undefined, next);
  }
  return renderMfaEnrollPage(
    state.otpauthUri,
    state.backupCodes,
    error,
    state.backupCodesAlreadyShown,
    next,
  );
}

/** GET /mfa/verify */
export function handleGetMfaVerify(c: Context): Response {
  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  return htmlResponse(c, renderMfaVerifyForm(undefined, next));
}

/** POST /mfa/verify */
export async function handlePostMfaVerify(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.MFA_PENDING) {
    return c.redirect("/login", 302);
  }

  const form = await parseForm(c);
  const code = form["code"]?.trim() ?? "";
  const rememberDevice = form["remember_device"] === "1";
  const next = resolveOptionalSafeRedirectPath(form["next"] ?? c.req.query("next"));

  if (!code) {
    return htmlResponse(c, renderMfaVerifyForm(MFA_ERROR, next), 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip, code))) {
    return c.text("Too many requests", 429);
  }

  const result = await completeMfa(db, {
    userId: partial.userId,
    sessionId: partial.sessionId,
    code,
    rememberDevice,
    ip,
    userAgent: c.req.header("user-agent"),
  });

  if (!result.ok) {
    return htmlResponse(c, renderMfaVerifyForm(MFA_ERROR, next), 401);
  }

  if (result.trustedDeviceRawToken) {
    await setTrustedDeviceCookie(c, db, result.trustedDeviceRawToken);
  }

  let landing: string;
  try {
    landing = await resolvePostLoginRedirectForUser(db, partial.userId, form["next"]);
  } catch (err) {
    await revokeSession(db, partial.sessionId);
    clearSessionCookie(c);
    console.error("post-login redirect:", err instanceof Error ? err.message : "unknown");
    return c.redirect("/login", 302);
  }
  return c.redirect(landing, 302);
}

/** GET /mfa/enroll — read-only; does not create enrollment (CSRF-safe). */
export async function handleGetMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  const pending = await resumePendingTotpEnrollment(db, partial.userId);
  if (!pending) {
    return htmlResponse(c, renderMfaEnrollStartPage(next));
  }

  return htmlResponse(c, renderEnrollFromState(partial.sessionId, pending, undefined, next));
}

/** POST /mfa/enroll/start — create pending TOTP + backup codes (CSRF-protected). */
export async function handlePostMfaEnrollStart(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const form = await parseForm(c);
  const next = resolveOptionalSafeRedirectPath(form["next"] ?? c.req.query("next"));

  const existing = await resumePendingTotpEnrollment(db, partial.userId);
  if (existing) {
    return htmlResponse(c, renderEnrollFromState(partial.sessionId, existing, undefined, next));
  }

  const enrollment = await startTotpEnrollment(db, partial.userId);
  if (!enrollment) {
    return c.redirect("/login", 302);
  }

  return htmlResponse(c, renderEnrollFromState(partial.sessionId, enrollment, undefined, next));
}

/** POST /mfa/enroll — confirm TOTP setup. */
export async function handlePostMfaEnroll(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const form = await parseForm(c);
  const code = form["code"]?.trim() ?? "";
  const next = resolveOptionalSafeRedirectPath(form["next"] ?? c.req.query("next"));
  if (!code) {
    const pending = await resumePendingTotpEnrollment(db, partial.userId);
    if (!pending) {
      return htmlResponse(c, renderMfaEnrollStartPage(next), 401);
    }
    return htmlResponse(c, renderEnrollFromState(partial.sessionId, pending, MFA_ERROR, next), 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip, code))) {
    return c.text("Too many requests", 429);
  }

  const ok = await confirmTotpEnrollment(db, partial.userId, code);
  if (!ok) {
    const pending = await resumePendingTotpEnrollment(db, partial.userId);
    if (!pending) {
      return htmlResponse(c, renderMfaEnrollStartPage(next), 401);
    }
    return htmlResponse(c, renderEnrollFromState(partial.sessionId, pending, MFA_ERROR, next), 401);
  }

  const promoted = await promoteSessionToFull(db, partial.sessionId, partial.userId);
  if (!promoted) {
    const pending = await resumePendingTotpEnrollment(db, partial.userId);
    if (!pending) {
      return htmlResponse(c, renderMfaEnrollStartPage(next), 401);
    }
    return htmlResponse(c, renderEnrollFromState(partial.sessionId, pending, MFA_ERROR, next), 401);
  }

  clearEnrollmentBackupCodes(partial.sessionId);

  let landing: string;
  try {
    landing = await resolvePostLoginRedirectForUser(db, partial.userId, form["next"]);
  } catch (err) {
    await revokeSession(db, partial.sessionId);
    clearSessionCookie(c);
    console.error("post-login redirect:", err instanceof Error ? err.message : "unknown");
    return c.redirect("/login", 302);
  }
  return c.redirect(landing, 302);
}

/** POST /mfa/enroll/download-codes — download backup codes as plain text (no inline JS). */
export async function handlePostMfaEnrollDownloadCodes(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const pending = await resumePendingTotpEnrollment(db, partial.userId);
  if (!pending) {
    return c.text("No pending enrollment.", 400);
  }

  const codes = await parseFormCodes(c);
  if (codes.length !== BACKUP_RECOVERY_CODE_COUNT) {
    return c.text("Invalid backup codes.", 400);
  }

  const matchedRowIds = new Set<string>();
  for (const code of codes) {
    const rowId = await findBackupRecoveryRowId(db, partial.userId, code);
    if (!rowId || matchedRowIds.has(rowId)) {
      return c.text("Invalid backup codes.", 400);
    }
    matchedRowIds.add(rowId);
  }

  for (const [name, value] of Object.entries(getMfaPageSecurityHeaders())) {
    c.header(name, value);
  }
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="admitto-backup-codes.txt"');
  return c.body(codes.join("\n") + "\n", 200);
}
