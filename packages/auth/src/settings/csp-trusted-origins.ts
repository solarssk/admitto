import type { PrismaClient, Prisma } from "@admitto/db";
import { getSetting } from "./resolver.js";
import { SETTING_CSP_TRUSTED_ORIGINS } from "./keys.js";

/** Upper bound on trusted origins, keeps the CSP header size sane and the admin UI reviewable. */
export const MAX_CSP_TRUSTED_ORIGINS = 10;

const FORBIDDEN_CSP_ORIGIN_VALUES = new Set([
  "'self'",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "*",
  "data:",
  "blob:",
]);

/** True when `raw` is exactly an `https://` origin (scheme + host [+ port]), no path, query,
 *  fragment, trailing slash, credentials, or wildcard host, and none of the CSP source-list
 *  keywords. `new URL()` accepts `*` and `*.example.com` as syntactically valid hostnames (the
 *  WHATWG URL spec doesn't forbid `*` in a host), so a host-wildcard check is required on top of
 *  the origin round-trip check below, or a CSP host-source wildcard like `https://*` would be
 *  accepted here and end up trusting every HTTPS origin. */
export function isValidCspTrustedOrigin(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || FORBIDDEN_CSP_ORIGIN_VALUES.has(trimmed)) return false;
  if (!trimmed.startsWith("https://")) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.hostname.includes("*")) return false;
  return parsed.origin === trimmed;
}

export class CspTrustedOriginsError extends Error {}

/** Strict validator for writes (system-settings PATCH). Throws on the first bad/duplicate/
 *  over-cap entry so the caller can surface a precise error instead of silently dropping input. */
export function validateCspTrustedOrigins(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new CspTrustedOriginsError("csp_trusted_origins must be an array");
  }
  if (raw.length > MAX_CSP_TRUSTED_ORIGINS) {
    throw new CspTrustedOriginsError(
      `csp_trusted_origins allows at most ${MAX_CSP_TRUSTED_ORIGINS} origins`,
    );
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new CspTrustedOriginsError("Each trusted origin must be a string");
    }
    const trimmed = entry.trim();
    if (!isValidCspTrustedOrigin(trimmed)) {
      throw new CspTrustedOriginsError(`Invalid trusted origin: ${entry}`);
    }
    if (seen.has(trimmed)) {
      throw new CspTrustedOriginsError(`Duplicate trusted origin: ${trimmed}`);
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

/** Defensive filter for the CSP header path: never throws. A hand-edited or otherwise
 *  corrupted SystemSettings row must not break the `/admin`, `/account`, `/operator`, or
 *  auth-page CSP; invalid or excess entries are silently dropped instead. */
export function sanitizeCspTrustedOrigins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!isValidCspTrustedOrigin(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= MAX_CSP_TRUSTED_ORIGINS) break;
  }
  return result;
}

/** Trusted third-party script/analytics origins from SystemSettings (`csp_trusted_origins`),
 *  appended to `script-src`/`connect-src` (staff SPA) and `script-src`/`connect-src`/`frame-src`
 *  (auth pages). Never throws. */
export async function getCspTrustedOrigins(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<string[]> {
  const v = await getSetting<unknown>(prisma, SETTING_CSP_TRUSTED_ORIGINS);
  return sanitizeCspTrustedOrigins(v);
}
