import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_STAGE,
  getOrStartTotpEnrollment,
  confirmTotpEnrollment,
  promoteSessionToFull,
  completeMfa,
} from "@admitto/auth";
import {
  getMfaPageSecurityHeaders,
  renderMfaVerifyForm,
  renderMfaEnrollPage,
} from "../mfa-page.js";
import { checkMfaVerifyRateLimit, resolveMfaClientIp } from "./mfa-rate-limit.js";
import { resolveSafeRedirectPath } from "./safe-redirect.js";
import { setTrustedDeviceCookie } from "./routes.js";
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

function resolvePostAuthRedirect(c: Context, formNext?: string): string {
  return resolveSafeRedirectPath(formNext ?? c.req.query("next"));
}

const MFA_ERROR = "Invalid code. Try again.";

/** Build enrollment HTML from current DB enrollment state (resume or fresh). */
function renderEnrollFromState(
  enrollment: Awaited<ReturnType<typeof getOrStartTotpEnrollment>>,
  error?: string,
  next?: string,
): string {
  if (!enrollment) {
    return renderMfaEnrollPage("", [], error, undefined, next);
  }
  return renderMfaEnrollPage(
    enrollment.otpauthUri,
    enrollment.backupCodes,
    error,
    enrollment.backupCodesAlreadyShown,
    next,
  );
}

/** GET /mfa/verify */
export function handleGetMfaVerify(c: Context): Response {
  const next = resolveSafeRedirectPath(c.req.query("next"));
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
  const next = resolvePostAuthRedirect(c, form["next"]);

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

  return c.redirect(next, 302);
}

/** GET /mfa/enroll — resume or start enrollment; does not rotate pending setup. */
export async function handleGetMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const enrollment = await getOrStartTotpEnrollment(db, partial.userId);
  if (!enrollment) {
    return c.redirect("/login", 302);
  }

  const next = resolveSafeRedirectPath(c.req.query("next"));
  return htmlResponse(c, renderEnrollFromState(enrollment, undefined, next));
}

/** POST /mfa/enroll — confirm TOTP setup. */
export async function handlePostMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const form = await parseForm(c);
  const code = form["code"]?.trim() ?? "";
  const next = resolvePostAuthRedirect(c, form["next"]);
  if (!code) {
    const enrollment = await getOrStartTotpEnrollment(db, partial.userId);
    return htmlResponse(c, renderEnrollFromState(enrollment, MFA_ERROR, next), 401);
  }

  const ok = await confirmTotpEnrollment(db, partial.userId, code);
  if (!ok) {
    const enrollment = await getOrStartTotpEnrollment(db, partial.userId);
    return htmlResponse(c, renderEnrollFromState(enrollment, MFA_ERROR, next), 401);
  }

  const promoted = await promoteSessionToFull(db, partial.sessionId, partial.userId);
  if (!promoted) {
    const enrollment = await getOrStartTotpEnrollment(db, partial.userId);
    return htmlResponse(c, renderEnrollFromState(enrollment, MFA_ERROR, next), 401);
  }

  return c.redirect(next, 302);
}
