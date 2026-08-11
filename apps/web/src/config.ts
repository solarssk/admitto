import type { PrismaClient } from "@admitto/db";
import {
  getCfAccessConfig,
  validateCfAccessBootConfigFromResolved,
  ensureCloudflareAccessProvider,
} from "@admitto/auth";
import { parseEnvFlag } from "./env-flags.js";
import { parseTrustedProxyCidrs } from "./rate-limit/trust-proxy.js";

export { resolveTrustProxy } from "./env-flags.js";

type EnvLike = Record<string, string | undefined>;

/** Minimum length for break-glass operator Bearer token (high entropy). */
export const MIN_CHECKIN_OPERATOR_TOKEN_LENGTH = 32;

/** Minimum length for ops readiness token (`OPS_HEALTH_TOKEN`). */
export const MIN_OPS_HEALTH_TOKEN_LENGTH = 32;

/** Minimum length for Redis password in production deploy. */
export const MIN_REDIS_PASSWORD_LENGTH = 16;

function normalizeCheckinOperatorToken(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < MIN_CHECKIN_OPERATOR_TOKEN_LENGTH) return null;
  return trimmed;
}

function normalizeBaseUrl(raw: string, env: EnvLike = process.env): string {
  const trimmed = raw.replace(/\/$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("BASE_URL must use http:// or https://");
    }
    if (env["NODE_ENV"] !== "development" && parsed.protocol === "http:") {
      const host = parsed.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") {
        throw new Error("BASE_URL must use https:// in non-development environments");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("BASE_URL")) throw err;
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
  if (url) return normalizeBaseUrl(url, env);
  if (env["NODE_ENV"] !== "development") {
    throw new Error("BASE_URL is required in non-development environments");
  }
  return "http://localhost:3000";
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
      "WARNING: ALLOW_CHECKIN_BEARER is enabled outside development. Emergency break-glass only.",
    );
  }
}

/** Normalize ops readiness token; returns null when unset or shorter than minimum. */
export function normalizeOpsHealthToken(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < MIN_OPS_HEALTH_TOKEN_LENGTH) return null;
  return trimmed;
}

/** Resolve `OPS_HEALTH_TOKEN` from env; null when unset or too short (endpoint disabled). */
export function resolveOpsHealthToken(env: EnvLike = process.env): string | null {
  return normalizeOpsHealthToken(env["OPS_HEALTH_TOKEN"]);
}

/** Resolve token from explicit test/deploy override or env. */
export function resolveOpsHealthTokenOption(
  explicit: string | null | undefined,
  env: EnvLike = process.env,
): string | null {
  if (explicit !== undefined) return normalizeOpsHealthToken(explicit);
  return resolveOpsHealthToken(env);
}

/** Fail fast when production Redis is missing or unauthenticated. */
export function validateRedisBootConfig(env: EnvLike = process.env): void {
  if (env["NODE_ENV"] === "development" || env["NODE_ENV"] === "test") return;
  const url = env["REDIS_URL"]?.trim();
  if (!url) {
    throw new Error(
      "REDIS_URL is required in non-development environments (set REDIS_PASSWORD in deploy/.env; compose wires redis://:password@redis:6379)",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("REDIS_URL must be a valid URL");
  }
  if (!parsed.password || parsed.password.length < MIN_REDIS_PASSWORD_LENGTH) {
    throw new Error(
      `REDIS_URL must include a password of at least ${MIN_REDIS_PASSWORD_LENGTH} characters in non-development environments`,
    );
  }
}

/** Fail fast when TRUSTED_PROXY_CIDRS is set but has no valid CIDR entry (unset is fine — loopback default). */
export function validateTrustedProxyCidrsBootConfig(env: EnvLike = process.env): void {
  const raw = env["TRUSTED_PROXY_CIDRS"]?.trim();
  if (!raw) return;
  parseTrustedProxyCidrs(raw);
}

/** Fail fast when production encryption key is missing or wrong size. */
export function validateEncryptionKeyBootConfig(env: EnvLike = process.env): void {
  if (env["NODE_ENV"] === "development" || env["NODE_ENV"] === "test") return;
  const raw = env["ENCRYPTION_KEY"]?.trim();
  if (!raw || raw === "CHANGE_ME") {
    throw new Error(
      "ENCRYPTION_KEY is required in non-development environments (generate: openssl rand -base64 32)",
    );
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY must be valid base64 (generate: openssl rand -base64 32)");
  }
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (generate: openssl rand -base64 32)");
  }
}

/** Warn when a too-short token is configured — `/readyz` stays disabled (404). */
export function validateOpsHealthBootConfig(env: EnvLike = process.env): void {
  const raw = env["OPS_HEALTH_TOKEN"]?.trim();
  if (!raw) return;
  if (raw.length < MIN_OPS_HEALTH_TOKEN_LENGTH) {
    console.warn(
      `OPS_HEALTH_TOKEN is set but shorter than ${MIN_OPS_HEALTH_TOKEN_LENGTH} characters; /readyz will stay disabled`,
    );
  }
}

/**
 * PassCreator config from env vars (temporary - Event Settings → Wallet replaces this with
 * stored per-org/per-event config in a later PR). Returns null when unconfigured so callers can
 * fail soft (redirect with an error) instead of crashing boot.
 */
export function resolvePassCreatorConfig(
  env: EnvLike = process.env,
): { apiKey: string; templateId: string; baseUrl?: string } | null {
  const apiKey = env["PASSCREATOR_API_KEY"]?.trim();
  const templateId = env["PASSCREATOR_TEMPLATE_ID"]?.trim();
  if (!apiKey || !templateId) return null;
  const rawBaseUrl = env["PASSCREATOR_BASE_URL"]?.trim();
  const baseUrl = rawBaseUrl?.startsWith("https://") ? rawBaseUrl : undefined;
  return { apiKey, templateId, ...(baseUrl ? { baseUrl } : {}) };
}

/** Boot-time validation for Cloudflare Access config (resolved env → DB → defaults). */
export async function validateCfAccessBootConfig(prisma: PrismaClient): Promise<void> {
  const config = await getCfAccessConfig(prisma);
  validateCfAccessBootConfigFromResolved(config);
  if (config.enabled) {
    await ensureCloudflareAccessProvider(prisma, config);
  }
}
