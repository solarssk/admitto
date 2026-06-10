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

/**
 * Resolve the static operator Bearer token for the /api/checkin/* gate (ADR 0003).
 * Returns the token when set, null in development when missing (routes return 503).
 * Throws in every non-development environment when missing — fail-fast at boot.
 */
export function resolveCheckinToken(env: EnvLike = process.env): string | null {
  const token = env["CHECKIN_OPERATOR_TOKEN"];
  if (token) return token;
  if (env["NODE_ENV"] !== "development") {
    throw new Error("CHECKIN_OPERATOR_TOKEN is required in non-development environments");
  }
  return null;
}
