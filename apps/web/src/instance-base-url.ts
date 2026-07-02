import type { PrismaClient } from "@prisma/client";
import { getInstanceUrl } from "@admitto/auth";
import { validateHttpUrl } from "@admitto/mail-templates";

/** Thrown when no env, DB, or injected instance URL is available in production. */
export class InstanceUrlRequiredError extends Error {
  constructor() {
    super("Instance URL is required (set BASE_URL or configure in Settings → General)");
    this.name = "InstanceUrlRequiredError";
  }
}

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

/** Persisted `instance_url` — always HTTPS, no trailing slash, no query or fragment. */
export function normalizePersistedInstanceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.endsWith("/")) {
    throw new Error("Instance URL must not end with a trailing slash");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Instance URL must be a valid https:// URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Instance URL must not include a query string or fragment");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Instance URL must not include credentials");
  }
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

  throw new InstanceUrlRequiredError();
}
