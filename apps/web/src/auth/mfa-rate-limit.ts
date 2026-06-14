import type { RateLimitStore } from "../rate-limit/types.js";
import { resolveClientIp } from "../rate-limit/client-ip.js";
import type { Context } from "hono";

const MFA_VERIFY_WINDOW_MS = 15 * 60_000;
const MFA_VERIFY_LIMIT = 10;

function mfaSessionKey(sessionId: string): string {
  return `mfa:session:${sessionId}`;
}

function mfaIpKey(ip: string): string {
  return `mfa:ip:${ip}`;
}

/**
 * Rate-limit MFA verification attempts per session and IP.
 * Returns false when throttled.
 */
export async function checkMfaVerifyRateLimit(
  store: RateLimitStore,
  sessionId: string,
  ip: string,
): Promise<boolean> {
  const sessionResult = await store.hit(
    mfaSessionKey(sessionId),
    MFA_VERIFY_WINDOW_MS,
    MFA_VERIFY_LIMIT,
  );
  if (!sessionResult.allowed) return false;
  const ipResult = await store.hit(mfaIpKey(ip), MFA_VERIFY_WINDOW_MS, MFA_VERIFY_LIMIT);
  return ipResult.allowed;
}

/** Client IP for MFA rate limiting (honours TRUST_PROXY). */
export function resolveMfaClientIp(c: Context): string {
  return resolveClientIp(c);
}
