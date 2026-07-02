import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { RATE_POLICIES } from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";

function mfaTotpSessionKey(sessionId: string): string {
  return `mfa:totp:session:${sessionId}`;
}

function mfaTotpIpKey(ip: string): string {
  return `mfa:totp:ip:${ip}`;
}

function mfaRecoverySessionKey(sessionId: string): string {
  return `mfa:recovery:session:${sessionId}`;
}

function mfaRecoveryIpKey(ip: string): string {
  return `mfa:recovery:ip:${ip}`;
}

/** True when the submitted value looks like a 6-digit TOTP (not a recovery code). */
export function isTotpMfaAttempt(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/\s/g, ""));
}

/**
 * Rate-limit MFA verification per session and IP.
 * Dual-key check stays inline — bucket choice depends on submitted code shape.
 */
export async function checkMfaVerifyRateLimit(
  store: RateLimitStore,
  sessionId: string,
  ip: string,
  code: string,
): Promise<boolean> {
  const totpAttempt = isTotpMfaAttempt(code);
  const policy = RATE_POLICIES[totpAttempt ? "mfa:verify-totp" : "mfa:verify-recovery"];
  const { windowMs, max } = policy.checks[0];

  const sessionKey = totpAttempt ? mfaTotpSessionKey(sessionId) : mfaRecoverySessionKey(sessionId);
  const ipKey = totpAttempt ? mfaTotpIpKey(ip) : mfaRecoveryIpKey(ip);

  const sessionResult = await store.hit(sessionKey, windowMs, max);
  if (!sessionResult.allowed) {
    logRateLimitExceeded({
      scope: "mfa_verify",
      ip,
      keyHint: totpAttempt ? "session_totp" : "session_recovery",
    });
    return false;
  }
  const ipResult = await store.hit(ipKey, windowMs, max);
  if (!ipResult.allowed) {
    logRateLimitExceeded({
      scope: "mfa_verify",
      ip,
      keyHint: totpAttempt ? "ip_totp" : "ip_recovery",
    });
    return false;
  }
  return true;
}

/** Client IP for MFA rate limiting (honours TRUST_PROXY). */
export function resolveMfaClientIp(c: Context): string {
  return resolveClientIp(c);
}

const mfaEnrollPolicy = RATE_POLICIES["mfa:enroll"].checks[0];

function enrollDenied(c: Context, format: "json" | "text"): Response {
  return format === "text"
    ? c.text("Too many requests", 429)
    : c.json({ error: "too many requests" }, 429);
}

/**
 * Rate-limit TOTP enrollment start per full session and IP (account self-service).
 * Dual-key + format option — stays outside generic rateLimit() wrapper.
 */
export function createAccountMfaEnrollRateLimitMiddleware(
  store: RateLimitStore,
  options: { format?: "json" | "text" } = {},
) {
  const format = options.format ?? "json";
  return async (c: Context, next: Next): Promise<Response | void> => {
    const auth = c.get("auth");
    const sessionId = auth?.sessionId;
    if (!sessionId) {
      return format === "text"
        ? c.text("Unauthorized", 401)
        : c.json({ error: "unauthorized" }, 401);
    }
    const ip = resolveClientIp(c);

    const sessionResult = await store.hit(
      `mfa:enroll:session:${sessionId}`,
      mfaEnrollPolicy.windowMs,
      mfaEnrollPolicy.max,
    );
    if (!sessionResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "session" });
      return enrollDenied(c, format);
    }

    const ipResult = await store.hit(`mfa:enroll:ip:${ip}`, mfaEnrollPolicy.windowMs, mfaEnrollPolicy.max);
    if (!ipResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "ip" });
      return enrollDenied(c, format);
    }

    await next();
  };
}

/** Rate-limit TOTP enrollment start per partial session and IP. */
export function createMfaEnrollRateLimitMiddleware(
  store: RateLimitStore,
  options: { format?: "json" | "text" } = {},
) {
  const format = options.format ?? "json";
  return async (c: Context, next: Next): Promise<Response | void> => {
    const partial = c.get("partialAuth");
    const ip = resolveClientIp(c);

    const sessionResult = await store.hit(
      `mfa:enroll:session:${partial.sessionId}`,
      mfaEnrollPolicy.windowMs,
      mfaEnrollPolicy.max,
    );
    if (!sessionResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "session" });
      return enrollDenied(c, format);
    }

    const ipResult = await store.hit(`mfa:enroll:ip:${ip}`, mfaEnrollPolicy.windowMs, mfaEnrollPolicy.max);
    if (!ipResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "ip" });
      return enrollDenied(c, format);
    }

    await next();
  };
}
