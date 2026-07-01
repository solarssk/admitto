import type { PrismaClient } from "@prisma/client";
import { getInstanceUrl } from "@admitto/auth";
import { validateHttpUrl } from "@admitto/mail-templates";

/** Normalize HTTPS instance URL — trim, strip trailing slash, validate scheme. */
export function normalizeInstanceUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return validateHttpUrl("BASE_URL", trimmed);
}

/**
 * Resolve public base URL for mail preview and ticket links:
 * env `BASE_URL` → DB `instance_url` → dev localhost → prod throw.
 */
export async function resolveInstanceBaseUrl(
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const fromEnv = env.BASE_URL?.trim();
  if (fromEnv) return normalizeInstanceUrl(fromEnv);

  const fromDb = await getInstanceUrl(db);
  if (fromDb) return normalizeInstanceUrl(fromDb);

  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return "http://localhost:3000";
  }

  throw new Error("BASE_URL is required in non-development environments");
}
