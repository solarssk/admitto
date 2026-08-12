import type { PrismaClient } from "@admitto/db";
import { buildOidcRedirectUri, InstanceUrlRequiredError } from "@admitto/auth";
import { resolveInstanceBaseUrl } from "../instance-base-url.js";

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
