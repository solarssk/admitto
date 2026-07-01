import type { PrismaClient } from "@prisma/client";
import { getInstanceUrl } from "@admitto/auth";
import { validateHttpUrl } from "@admitto/mail-templates";

/** Runtime URL policy aligned with `config.ts` `normalizeBaseUrl`. */
export function normalizeRuntimeBaseUrl(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("BASE_URL must use http:// or https://");
    }
    if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
      if (parsed.protocol === "http:") {
        const host = parsed.hostname;
        if (host !== "localhost" && host !== "127.0.0.1") {
          throw new Error("BASE_URL must use https:// in non-development environments");
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("BASE_URL")) throw err;
    throw new Error("BASE_URL must be a valid http:// or https:// URL");
  }
  return validateHttpUrl("BASE_URL", trimmed);
}

/** Persisted `instance_url` — always HTTPS (superadmin DB setting). */
export function normalizePersistedInstanceUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  const validated = validateHttpUrl("BASE_URL", trimmed);
  if (!validated.startsWith("https://")) {
    throw new Error("Instance URL must use https://");
  }
  return validated;
}

/**
 * Resolve public base URL for mail preview and ticket links:
 * env `BASE_URL` → DB `instance_url` → injected `createApp` baseUrl → dev localhost → prod throw.
 */
export async function resolveInstanceBaseUrl(
  db: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  injectedBaseUrl?: string,
): Promise<string> {
  const fromEnv = env.BASE_URL?.trim();
  if (fromEnv) return normalizeRuntimeBaseUrl(fromEnv, env);

  const fromDb = await getInstanceUrl(db);
  if (fromDb) return normalizePersistedInstanceUrl(fromDb);

  const injected = injectedBaseUrl?.trim();
  if (injected) return normalizeRuntimeBaseUrl(injected, env);

  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return "http://localhost:3000";
  }

  throw new Error("BASE_URL is required in non-development environments");
}
