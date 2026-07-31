import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import type { StartTotpEnrollmentResult } from "@admitto/auth";
import { generateQrPng } from "@admitto/tickets";
import {
  SESSION_STAGE,
  resumePendingTotpEnrollment,
  startTotpEnrollment,
  confirmTotpEnrollment,
  promoteSessionToFull,
  promoteSessionToBackupCodesStep,
  completeMfa,
  revokeSession,
  BACKUP_RECOVERY_CODE_COUNT,
  verifyBackupRecoveryCodesSet,
  regenerateBackupRecoveryCodes,
  markBackupCodesAcknowledged,
  parseTotpSecretFromOtpauthUri,
} from "@admitto/auth";
import {
  getMfaEnrollPageSecurityHeaders,
  getMfaPageSecurityHeaders,
  renderMfaVerifyForm,
  renderMfaEnrollQrPage,
  renderMfaEnrollBackupCodesPage,
  renderMfaEnrollStartPage,
} from "../mfa-page.js";
import { createAuthPageScriptNonce } from "../auth-page-security.js";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "./mfa-rate-limit.js";
import {
  clearEnrollmentBackupCodes,
  extendEnrollmentBackupCodes,
  getStashedEnrollmentBackupCodes,
  stashEnrollmentBackupCodes,
  submittedCodesMatchStashedEnrollmentBackup,
} from "./enrollment-backup-cache.js";
import { ensureEnrollmentBackupCodesStashed } from "./ensure-backup-codes.js";
import { resolveOptionalSafeRedirectPath } from "./safe-redirect.js";
import { resolvePostLoginRedirectForUser } from "./post-login-redirect.js";
import { setTrustedDeviceCookie, clearSessionCookie } from "./routes.js";
import type { RateLimitStore } from "../rate-limit/types.js";

function htmlResponse(c: Context, html: string, scriptNonce: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getMfaPageSecurityHeaders(scriptNonce))) {
    c.header(name, value);
  }
  return c.html(html, status);
}

function htmlEnrollResponse(c: Context, html: string, scriptNonce: string, status: 200 | 401 = 200): Response {
  for (const [name, value] of Object.entries(getMfaEnrollPageSecurityHeaders(scriptNonce))) {
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

/** Stash backup codes at enrollment start; QR step never displays them. */
function stashFreshEnrollmentBackupCodes(
  sessionId: string,
  enrollment: StartTotpEnrollmentResult,
): void {
  if (enrollment.backupCodes.length > 0) {
    stashEnrollmentBackupCodes(sessionId, enrollment.backupCodes);
  }
}

/** Build QR enrollment HTML from current DB enrollment state (no backup codes). */
async function renderEnrollQrFromState(
  scriptNonce: string,
  sessionId: string,
  enrollment: StartTotpEnrollmentResult | null,
  error?: string,
  next?: string,
): Promise<string> {
  if (!enrollment?.otpauthUri) {
    return renderMfaEnrollQrPage({
      scriptNonce,
      otpauthUri: "",
      setupKey: "",
      qrDataUri: "",
      error,
      next,
    });
  }

  const setupKey = parseTotpSecretFromOtpauthUri(enrollment.otpauthUri) ?? "";
  const png = await generateQrPng(enrollment.otpauthUri);
  const qrDataUri = `data:image/png;base64,${png.toString("base64")}`;

  return renderMfaEnrollQrPage({
    scriptNonce,
    otpauthUri: enrollment.otpauthUri,
    setupKey,
    qrDataUri,
    error,
    next,
  });
}

function renderBackupCodesPageForSession(
  scriptNonce: string,
  sessionId: string,
  error?: string,
  next?: string,
): string {
  const stashed = getStashedEnrollmentBackupCodes(sessionId);
  return renderMfaEnrollBackupCodesPage({
    scriptNonce,
    backupCodes: stashed ?? [],
    codesUnavailable: !stashed?.length,
    error,
    next,
  });
}

async function redirectAfterFullEnrollment(
  c: Context,
  db: PrismaClient,
  userId: string,
  sessionId: string,
  nextRaw?: string,
): Promise<Response> {
  clearEnrollmentBackupCodes(sessionId);

  let landing: string;
  try {
    landing = await resolvePostLoginRedirectForUser(db, userId, nextRaw);
  } catch (err) {
    await revokeSession(db, sessionId);
    clearSessionCookie(c);
    console.error("post-login redirect:", err instanceof Error ? err.message : "unknown");
    return c.redirect("/login", 302);
  }
  return c.redirect(landing, 302);
}

/** GET /mfa/verify */
export function handleGetMfaVerify(c: Context): Response {
  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  const scriptNonce = createAuthPageScriptNonce();
  return htmlResponse(c, renderMfaVerifyForm(scriptNonce, undefined, next), scriptNonce);
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
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderMfaVerifyForm(scriptNonce, MFA_ERROR, next), scriptNonce, 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip, code))) {
    return c.text("Too many requests", 429);
  }

  const result = await completeMfa(
    db,
    {
      userId: partial.userId,
      sessionId: partial.sessionId,
      code,
      rememberDevice,
      ip,
      userAgent: c.req.header("user-agent"),
    },
    {
      userId: partial.userId,
      sessionId: partial.sessionId,
      ip,
      userAgent: c.req.header("user-agent"),
    },
  );

  if (!result.ok) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlResponse(c, renderMfaVerifyForm(scriptNonce, MFA_ERROR, next), scriptNonce, 401);
  }

  if (result.trustedDeviceRawToken) {
    await setTrustedDeviceCookie(c, db, result.trustedDeviceRawToken);
  }

  // User still owes backup-code acknowledgment — route to the backup-codes step
  // instead of granting full access (IAM-002).
  if (result.stage === SESSION_STAGE.BACKUP_CODES_REQUIRED) {
    await ensureEnrollmentBackupCodesStashed(db, partial.sessionId, partial.userId);
    const next = resolveOptionalSafeRedirectPath(form["next"] ?? c.req.query("next"));
    const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";
    return c.redirect(`/mfa/enroll/backup-codes${nextQuery}`, 302);
  }
  if (result.stage === SESSION_STAGE.CHANGE_PASSWORD_REQUIRED) {
    return c.redirect("/change-password", 302);
  }

  return redirectAfterFullEnrollment(c, db, partial.userId, partial.sessionId, form["next"]);
}

/** GET /mfa/enroll — read-only; does not create enrollment (CSRF-safe). */
export async function handleGetMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");

  if (partial.stage === SESSION_STAGE.BACKUP_CODES_REQUIRED) {
    const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
    return c.redirect(next ? `/mfa/enroll/backup-codes?next=${encodeURIComponent(next)}` : "/mfa/enroll/backup-codes", 302);
  }

  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  const pending = await resumePendingTotpEnrollment(db, partial.userId);
  const scriptNonce = createAuthPageScriptNonce();
  if (!pending) {
    return htmlEnrollResponse(c, renderMfaEnrollStartPage(scriptNonce, next), scriptNonce);
  }

  return htmlEnrollResponse(c, await renderEnrollQrFromState(scriptNonce, partial.sessionId, pending, undefined, next), scriptNonce);
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
    const scriptNonce = createAuthPageScriptNonce();
    return htmlEnrollResponse(c, await renderEnrollQrFromState(scriptNonce, partial.sessionId, existing, undefined, next), scriptNonce);
  }

  const enrollment = await startTotpEnrollment(db, partial.userId);
  if (!enrollment) {
    return c.redirect("/login", 302);
  }

  stashFreshEnrollmentBackupCodes(partial.sessionId, enrollment);
  const scriptNonce = createAuthPageScriptNonce();
  return htmlEnrollResponse(c, await renderEnrollQrFromState(scriptNonce, partial.sessionId, enrollment, undefined, next), scriptNonce);
}

/** POST /mfa/enroll — confirm TOTP setup, then advance to backup-codes step. */
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
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  if (!code) {
    const pending = await resumePendingTotpEnrollment(db, partial.userId);
    const scriptNonce = createAuthPageScriptNonce();
    if (!pending) {
      return htmlEnrollResponse(c, renderMfaEnrollStartPage(scriptNonce, next), scriptNonce, 401);
    }
    return htmlEnrollResponse(c, await renderEnrollQrFromState(scriptNonce, partial.sessionId, pending, MFA_ERROR, next), scriptNonce, 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip, code))) {
    return c.text("Too many requests", 429);
  }

  const ok = await confirmTotpEnrollment(db, partial.userId, code);
  if (!ok) {
    const pending = await resumePendingTotpEnrollment(db, partial.userId);
    const scriptNonce = createAuthPageScriptNonce();
    if (!pending) {
      return htmlEnrollResponse(c, renderMfaEnrollStartPage(scriptNonce, next), scriptNonce, 401);
    }
    return htmlEnrollResponse(c, await renderEnrollQrFromState(scriptNonce, partial.sessionId, pending, MFA_ERROR, next), scriptNonce, 401);
  }

  // Ensure backup codes are in the stash. They may be missing when the enrollment
  // was started on a different instance or the original stash expired. Regenerate
  // before promoting so the backup-codes page always has codes to display.
  if (!getStashedEnrollmentBackupCodes(partial.sessionId)) {
    const { codes } = await regenerateBackupRecoveryCodes(db, partial.userId);
    stashEnrollmentBackupCodes(partial.sessionId, codes);
  }

  const promoted = await promoteSessionToBackupCodesStep(db, partial.sessionId, partial.userId);
  if (!promoted) {
    const pending = await resumePendingTotpEnrollment(db, partial.userId);
    const scriptNonce = createAuthPageScriptNonce();
    if (!pending) {
      return htmlEnrollResponse(c, renderMfaEnrollStartPage(scriptNonce, next), scriptNonce, 401);
    }
    return htmlEnrollResponse(c, await renderEnrollQrFromState(scriptNonce, partial.sessionId, pending, MFA_ERROR, next), scriptNonce, 401);
  }

  // Extend stash TTL to match the fresh backup-codes session window.
  extendEnrollmentBackupCodes(partial.sessionId);

  return c.redirect(`/mfa/enroll/backup-codes${nextQuery}`, 302);
}

/** GET /mfa/enroll/backup-codes — show one-time backup recovery codes. */
export async function handleGetMfaEnrollBackupCodes(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.BACKUP_CODES_REQUIRED) {
    return c.redirect("/login", 302);
  }

  await ensureEnrollmentBackupCodesStashed(db, partial.sessionId, partial.userId);

  const next = resolveOptionalSafeRedirectPath(c.req.query("next"));
  const scriptNonce = createAuthPageScriptNonce();
  return htmlEnrollResponse(c, renderBackupCodesPageForSession(scriptNonce, partial.sessionId, undefined, next), scriptNonce);
}

/** POST /mfa/enroll/backup-codes — acknowledge backup codes and enter the app. */
export async function handlePostMfaEnrollBackupCodes(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.BACKUP_CODES_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const form = await parseForm(c);
  const next = resolveOptionalSafeRedirectPath(form["next"] ?? c.req.query("next"));

  // Refuse to complete enrollment if backup codes are unavailable in the stash
  // (e.g. app restart or second instance handled the QR step). Completing without
  // displaying the codes would silently leave the user with no recovery path.
  const stashed = getStashedEnrollmentBackupCodes(partial.sessionId);
  if (!stashed?.length) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlEnrollResponse(
      c,
      renderBackupCodesPageForSession(scriptNonce, partial.sessionId, "Backup codes are no longer available. Please log in again to restart enrollment.", next),
      scriptNonce,
      401,
    );
  }

  // Record acknowledgment and promote atomically so a DB fault cannot leave
  // codes acknowledged while the session stays in backup_codes_required.
  const promoted = await db.$transaction(async (tx) => {
    await markBackupCodesAcknowledged(tx, partial.userId);
    return promoteSessionToFull(tx, partial.sessionId, partial.userId);
  });
  if (!promoted) {
    const scriptNonce = createAuthPageScriptNonce();
    return htmlEnrollResponse(
      c,
      renderBackupCodesPageForSession(scriptNonce, partial.sessionId, "Could not complete setup. Try again.", next),
      scriptNonce,
      401,
    );
  }
  if (promoted === SESSION_STAGE.CHANGE_PASSWORD_REQUIRED) {
    clearEnrollmentBackupCodes(partial.sessionId);
    return c.redirect("/change-password", 302);
  }

  return redirectAfterFullEnrollment(c, db, partial.userId, partial.sessionId, form["next"]);
}

/** POST /mfa/enroll/download-codes — download backup codes as plain text (no inline JS). */
export async function handlePostMfaEnrollDownloadCodes(
  c: Context,
  db: PrismaClient,
): Promise<Response> {
  const partial = c.get("partialAuth");
  if (
    partial.stage !== SESSION_STAGE.BACKUP_CODES_REQUIRED &&
    partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED
  ) {
    return c.redirect("/login", 302);
  }

  const codes = await parseFormCodes(c);
  if (codes.length !== BACKUP_RECOVERY_CODE_COUNT) {
    return c.text("Invalid backup codes.", 400);
  }

  const stashed = getStashedEnrollmentBackupCodes(partial.sessionId);
  if (stashed) {
    if (!submittedCodesMatchStashedEnrollmentBackup(partial.sessionId, codes)) {
      return c.text("Invalid backup codes.", 400);
    }
  } else if (!(await verifyBackupRecoveryCodesSet(db, partial.userId, codes))) {
    return c.text("Invalid backup codes.", 400);
  }

  // Plain-text download ships no scripts; nonce is only generated to satisfy the shared header shape.
  for (const [name, value] of Object.entries(getMfaEnrollPageSecurityHeaders(createAuthPageScriptNonce()))) {
    c.header(name, value);
  }
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="admitto-backup-codes.txt"');
  return c.body(codes.join("\n") + "\n", 200);
}
