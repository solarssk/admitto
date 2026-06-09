type EnvLike = Record<string, string | undefined>;

/**
 * Resolve the absolute base URL used for public ticket links and QR payloads.
 * In production the value must be configured explicitly; localhost fallback is dev-only.
 */
export function resolveBaseUrl(env: EnvLike = process.env): string {
  const url = env["BASE_URL"];
  if (url) return url.replace(/\/$/, "");
  if (env["NODE_ENV"] === "production") {
    throw new Error("BASE_URL environment variable is required in production");
  }
  return "http://localhost:3000";
}
