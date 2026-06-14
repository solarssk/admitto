type EnvLike = Record<string, string | undefined>;

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("BASE_URL must use http:// or https://");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("http")) throw err;
    throw new Error("BASE_URL must be a valid http:// or https:// URL");
  }
  return trimmed;
}

/**
 * Resolve the absolute base URL used for public ticket links and QR payloads.
 * In production the value must be configured explicitly; localhost fallback is dev-only.
 */
export function resolveBaseUrl(env: EnvLike = process.env): string {
  const url = env["BASE_URL"];
  if (url) return normalizeBaseUrl(url);
  if (env["NODE_ENV"] !== "development") {
    throw new Error("BASE_URL is required in non-development environments");
  }
  return "http://localhost:3000";
}

function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

/**
 * Emergency break-glass: allow ADR 0003 Bearer on /api/checkin/* (default false).
 */
export function resolveAllowCheckinBearer(env: EnvLike = process.env): boolean {
  return parseEnvFlag(env["ALLOW_CHECKIN_BEARER"]);
}

/**
 * Resolve the static operator Bearer token when emergency Bearer path is enabled.
 * Returns null when unset; required at boot when ALLOW_CHECKIN_BEARER=true in non-dev.
 */
export function resolveCheckinToken(env: EnvLike = process.env): string | null {
  const token = env["CHECKIN_OPERATOR_TOKEN"];
  return token && token.length > 0 ? token : null;
}

/**
 * Boot-time validation for check-in gate config.
 * Throws when Bearer emergency mode is enabled without a token in non-development.
 */
export function validateCheckinBootConfig(env: EnvLike = process.env): void {
  const allowBearer = resolveAllowCheckinBearer(env);
  const token = resolveCheckinToken(env);

  if (allowBearer && env["NODE_ENV"] !== "development" && !token) {
    throw new Error(
      "CHECKIN_OPERATOR_TOKEN is required when ALLOW_CHECKIN_BEARER=true in non-development environments",
    );
  }

  if (allowBearer && env["NODE_ENV"] !== "development") {
    console.warn(
      "WARNING: ALLOW_CHECKIN_BEARER is enabled outside development — emergency break-glass only",
    );
  }
}
