import type { PrismaClient } from "@admitto/db";
import { buildOidcRedirectUri, InstanceUrlRequiredError } from "@admitto/auth";
import { resolveInstanceBaseUrl } from "../instance-base-url.js";
import { safeErrorFields } from "../safe-error-fields.js";

/** Same public base OIDC start/callback use (env BASE_URL → DB instance_url → localhost in test/dev). */
export async function resolveOidcRedirectUri(
  db: PrismaClient,
  providerId: string,
  injectedBaseUrl?: string,
): Promise<string | null> {
  try {
    const base = await resolveInstanceBaseUrl(db, process.env, injectedBaseUrl);
    return buildOidcRedirectUri(base, providerId);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) return null;
    throw err;
  }
}

/**
 * Same resolution, but for a caller that must still complete when Instance URL isn't configured
 * yet - unlike OIDC start/callback/link (which genuinely cannot proceed without an exact base
 * URL), logout must never fail just because that setting is missing.
 */
export async function resolveOidcPublicBaseUrlOrNull(
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<string | null> {
  try {
    return await resolveInstanceBaseUrl(db, process.env, injectedBaseUrl);
  } catch (err) {
    if (err instanceof InstanceUrlRequiredError) return null;
    throw err;
  }
}

/**
 * `resolveOidcPublicBaseUrlOrNull` for a sign out, which must succeed locally whatever the configuration:
 * any other failure (a malformed `BASE_URL` or instance URL, a database error) reads as "no base URL" too, so
 * the identity provider's end-session handoff, which is optional, is skipped instead of the sign out failing
 * with the session still open. Logs the error's name and code only, never its message.
 */
export async function resolveLogoutBaseUrl(
  db: PrismaClient,
  injectedBaseUrl?: string,
): Promise<string | null> {
  try {
    return await resolveOidcPublicBaseUrlOrNull(db, injectedBaseUrl);
  } catch (err) {
    console.error("resolve base URL for sign out failed:", safeErrorFields(err));
    return null;
  }
}
