import type { Context, Next } from "hono";
import { logRateLimitExceeded } from "@admitto/auth";
import { INLINE_RATE_LIMITS } from "../rate-limit/policies.js";
import type { RateLimitStore } from "../rate-limit/types.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";

function mfaTotpSessionKey(sessionId: string, action?: string): string {
  return action ? `mfa:totp:session:${action}:${sessionId}` : `mfa:totp:session:${sessionId}`;
}

function mfaTotpIpKey(ip: string, action?: string): string {
  return action ? `mfa:totp:ip:${action}:${ip}` : `mfa:totp:ip:${ip}`;
}

function mfaRecoverySessionKey(sessionId: string, action?: string): string {
  return action ? `mfa:recovery:session:${action}:${sessionId}` : `mfa:recovery:session:${sessionId}`;
}

function mfaRecoveryIpKey(ip: string, action?: string): string {
  return action ? `mfa:recovery:ip:${action}:${ip}` : `mfa:recovery:ip:${ip}`;
}

/** True when the submitted value looks like a 6-digit TOTP (not a recovery code). */
export function isTotpMfaAttempt(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/\s/g, ""));
}

/**
 * Rate-limit MFA verification per session and IP.
 * Dual-key check stays inline — bucket choice depends on submitted code shape.
 *
 * `action` namespaces the bucket per call site (e.g. "oidc-link", "mfa-confirm",
 * "mfa-reset") so unrelated self-service actions sharing a session don't throttle each
 * other. Omit it only for the login-time step-up flow, which keeps its original,
 * un-namespaced key.
 */
export async function checkMfaVerifyRateLimit(
  store: RateLimitStore,
  sessionId: string,
  ip: string,
  code: string,
  action?: string,
): Promise<boolean> {
  const totpAttempt = isTotpMfaAttempt(code);
  const { windowMs, max } =
    INLINE_RATE_LIMITS[totpAttempt ? "mfa:verify-totp" : "mfa:verify-recovery"];

  const sessionKey = totpAttempt
    ? mfaTotpSessionKey(sessionId, action)
    : mfaRecoverySessionKey(sessionId, action);
  const ipKey = totpAttempt ? mfaTotpIpKey(ip, action) : mfaRecoveryIpKey(ip, action);

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

function mfaWebauthnSessionKey(sessionId: string, action?: string): string {
  return action ? `mfa:webauthn:session:${action}:${sessionId}` : `mfa:webauthn:session:${sessionId}`;
}

function mfaWebauthnIpKey(ip: string, action?: string): string {
  return action ? `mfa:webauthn:ip:${action}:${ip}` : `mfa:webauthn:ip:${ip}`;
}

/**
 * Rate-limit a WebAuthn step-up/login attempt per session and IP — same session+IP dual-key shape
 * as `checkMfaVerifyRateLimit`, but a single bucket: an assertion attempt has no code value to
 * branch a TOTP-vs-recovery bucket choice on.
 */
export async function checkWebauthnStepUpRateLimit(
  store: RateLimitStore,
  sessionId: string,
  ip: string,
  action?: string,
): Promise<boolean> {
  const { windowMs, max } = INLINE_RATE_LIMITS["mfa:verify-webauthn"];

  const sessionResult = await store.hit(mfaWebauthnSessionKey(sessionId, action), windowMs, max);
  if (!sessionResult.allowed) {
    logRateLimitExceeded({ scope: "mfa_verify", ip, keyHint: "session_webauthn" });
    return false;
  }
  const ipResult = await store.hit(mfaWebauthnIpKey(ip, action), windowMs, max);
  if (!ipResult.allowed) {
    logRateLimitExceeded({ scope: "mfa_verify", ip, keyHint: "ip_webauthn" });
    return false;
  }
  return true;
}

/** Client IP for MFA rate limiting (honours TRUST_PROXY). */
export function resolveMfaClientIp(c: Context): string {
  return resolveClientIp(c);
}

const mfaEnrollLimit = INLINE_RATE_LIMITS["mfa:enroll"];

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
      mfaEnrollLimit.windowMs,
      mfaEnrollLimit.max,
    );
    if (!sessionResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "session" });
      return enrollDenied(c, format);
    }

    const ipResult = await store.hit(`mfa:enroll:ip:${ip}`, mfaEnrollLimit.windowMs, mfaEnrollLimit.max);
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
      mfaEnrollLimit.windowMs,
      mfaEnrollLimit.max,
    );
    if (!sessionResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "session" });
      return enrollDenied(c, format);
    }

    const ipResult = await store.hit(`mfa:enroll:ip:${ip}`, mfaEnrollLimit.windowMs, mfaEnrollLimit.max);
    if (!ipResult.allowed) {
      logRateLimitExceeded({ scope: "mfa_enroll", ip, keyHint: "ip" });
      return enrollDenied(c, format);
    }

    await next();
  };
}
