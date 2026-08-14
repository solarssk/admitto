import type { PrismaClient } from "@admitto/db";
import { getCspTrustedOrigins } from "@admitto/auth";

/** Fail-open read of Settings → Security's trusted CSP origins: on a DB error, returns `[]`
 *  (a stricter policy) instead of throwing, so this non-critical opt-in enhancement never
 *  takes down the staff SPA shell or an auth page. */
export async function resolveCspTrustedOriginsSafe(db: PrismaClient): Promise<string[]> {
  try {
    return await getCspTrustedOrigins(db);
  } catch {
    return [];
  }
}
