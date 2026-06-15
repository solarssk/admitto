import type { PrismaClient } from "@prisma/client";
import { getCfAccessConfig, validateCfAccessBootConfigFromResolved } from "@admitto/auth";

type EnvLike = Record<string, string | undefined>;

/** Minimum length for break-glass operator Bearer token (high entropy). */
export const MIN_CHECKIN_OPERATOR_TOKEN_LENGTH = 32;

function normalizeCheckinOperatorToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_CHECKIN_OPERATOR_TOKEN_LENGTH) return null;
  return trimmed;
}

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
 * Trust reverse-proxy forwarded headers (`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`).
 * Required in production behind nginx/traefik that overwrites client-supplied values.
 */
export function resolveTrustProxy(env: EnvLike = process.env): boolean {
  return parseEnvFlag(env["TRUST_PROXY"]);
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
  return normalizeCheckinOperatorToken(env["CHECKIN_OPERATOR_TOKEN"]);
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
      `CHECKIN_OPERATOR_TOKEN is required when ALLOW_CHECKIN_BEARER=true in non-development environments (minimum ${MIN_CHECKIN_OPERATOR_TOKEN_LENGTH} characters)`,
    );
  }

  if (allowBearer && env["NODE_ENV"] !== "development") {
    console.warn(
      "WARNING: ALLOW_CHECKIN_BEARER is enabled outside development — emergency break-glass only",
    );
  }
}

/** Boot-time validation for Cloudflare Access config (resolved env → DB → defaults). */
export async function validateCfAccessBootConfig(prisma: PrismaClient): Promise<void> {
  const config = await getCfAccessConfig(prisma);
  validateCfAccessBootConfigFromResolved(config);
}
