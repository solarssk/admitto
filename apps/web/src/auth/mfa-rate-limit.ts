import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import type { RateLimitStore } from "../rate-limit/types.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";

const MFA_VERIFY_WINDOW_MS = 15 * 60_000;
/** Brute-force guard for 6-digit TOTP. */
const MFA_TOTP_VERIFY_LIMIT = 10;
/** Separate, more generous bucket for high-entropy recovery codes (user typos). */
const MFA_RECOVERY_VERIFY_LIMIT = 30;

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
 * TOTP and recovery codes use separate buckets (recovery is not brute-forceable but users typo).
 * Returns false when throttled.
 */
export async function checkMfaVerifyRateLimit(
  store: RateLimitStore,
  sessionId: string,
  ip: string,
  code: string,
): Promise<boolean> {
  const totpAttempt = isTotpMfaAttempt(code);

  const sessionKey = totpAttempt ? mfaTotpSessionKey(sessionId) : mfaRecoverySessionKey(sessionId);
  const ipKey = totpAttempt ? mfaTotpIpKey(ip) : mfaRecoveryIpKey(ip);
  const limit = totpAttempt ? MFA_TOTP_VERIFY_LIMIT : MFA_RECOVERY_VERIFY_LIMIT;

  const sessionResult = await store.hit(sessionKey, MFA_VERIFY_WINDOW_MS, limit);
  if (!sessionResult.allowed) {
    logRateLimitExceeded({ scope: "mfa_verify", ip, keyHint: totpAttempt ? "session_totp" : "session_recovery" });
    return false;
  }
  const ipResult = await store.hit(ipKey, MFA_VERIFY_WINDOW_MS, limit);
  if (!ipResult.allowed) {
    logRateLimitExceeded({ scope: "mfa_verify", ip, keyHint: totpAttempt ? "ip_totp" : "ip_recovery" });
    return false;
  }
  return true;
}

/** Client IP for MFA rate limiting (honours TRUST_PROXY). */
export function resolveMfaClientIp(c: Context): string {
  return resolveClientIp(c);
}

const MFA_ENROLL_WINDOW_MS = 15 * 60_000;
const MFA_ENROLL_MAX_REQUESTS = 10;

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
      MFA_ENROLL_WINDOW_MS,
      MFA_ENROLL_MAX_REQUESTS,
    );
    if (!sessionResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "session" });
      return format === "text"
        ? c.text("Too many requests", 429)
        : c.json({ error: "too many requests" }, 429);
    }

    const ipResult = await store.hit(`mfa:enroll:ip:${ip}`, MFA_ENROLL_WINDOW_MS, MFA_ENROLL_MAX_REQUESTS);
    if (!ipResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "ip" });
      return format === "text"
        ? c.text("Too many requests", 429)
        : c.json({ error: "too many requests" }, 429);
    }

    await next();
  };
}
