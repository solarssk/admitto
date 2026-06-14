import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import {
  SESSION_STAGE,
  startTotpEnrollment,
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

const MFA_ERROR = "Invalid code. Try again.";

/** GET /mfa/verify */
export function handleGetMfaVerify(c: Context): Response {
  return htmlResponse(c, renderMfaVerifyForm());
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

  if (!code) {
    return htmlResponse(c, renderMfaVerifyForm(MFA_ERROR), 401);
  }

  const ip = resolveMfaClientIp(c);
  if (!(await checkMfaVerifyRateLimit(rateLimitStore, partial.sessionId, ip))) {
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
    return htmlResponse(c, renderMfaVerifyForm(MFA_ERROR), 401);
  }

  if (result.trustedDeviceRawToken) {
    setTrustedDeviceCookie(c, result.trustedDeviceRawToken);
  }

  return c.redirect("/operator", 302);
}

/** GET /mfa/enroll — starts enrollment and shows one-time URI + backup codes. */
export async function handleGetMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const enrollment = await startTotpEnrollment(db, partial.userId);
  if (!enrollment) {
    return c.redirect("/login", 302);
  }

  return htmlResponse(
    c,
    renderMfaEnrollPage(enrollment.otpauthUri, enrollment.backupCodes),
  );
}

/** POST /mfa/enroll — confirm TOTP setup. */
export async function handlePostMfaEnroll(c: Context, db: PrismaClient): Promise<Response> {
  const partial = c.get("partialAuth");
  if (partial.stage !== SESSION_STAGE.ENROLLMENT_REQUIRED) {
    return c.redirect("/login", 302);
  }

  const form = await parseForm(c);
  const code = form["code"]?.trim() ?? "";
  if (!code) {
    return htmlResponse(c, renderMfaEnrollPage("", [], MFA_ERROR), 401);
  }

  const ok = await confirmTotpEnrollment(db, partial.userId, code);
  if (!ok) {
    return htmlResponse(c, renderMfaEnrollPage("", [], MFA_ERROR), 401);
  }

  await promoteSessionToFull(db, partial.sessionId, partial.userId);
  return c.redirect("/operator", 302);
}
