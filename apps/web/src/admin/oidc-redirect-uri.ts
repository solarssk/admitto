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
