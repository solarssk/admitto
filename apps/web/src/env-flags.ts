type EnvLike = Record<string, string | undefined>;

export function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

/**
 * Trust reverse-proxy forwarded headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`).
 * Kept free of `@admitto/auth` imports so rate-limit helpers do not pull the auth/tickets barrel.
 */
export function resolveTrustProxy(env: EnvLike = process.env): boolean {
  return parseEnvFlag(env["TRUST_PROXY"]);
}
