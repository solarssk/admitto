import type { PrismaClient, Prisma } from "@admitto/db";
import {
  SETTING_CF_ACCESS_AUD,
  SETTING_CF_ACCESS_ENABLED,
  SETTING_CF_ACCESS_PROTECTED_PREFIXES,
  SETTING_CF_ACCESS_TEAM_DOMAIN,
} from "../settings/keys.js";
import { getSetting } from "../settings/resolver.js";

export interface CfAccessConfig {
  enabled: boolean;
  teamDomain: string;
  audience: string[];
  protectedPrefixes: string[];
  jwksUri: string;
}

const TEAM_DOMAIN_RE = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\/?$/i;

/** Normalize and validate Cloudflare Access team issuer URL. */
export function normalizeCfAccessTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN is required when Cloudflare Access is enabled");
  }
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must be a valid https:// URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must use https://");
  }
  const normalized = url.origin;
  if (!TEAM_DOMAIN_RE.test(`${normalized}/`)) {
    throw new Error("CF_ACCESS_TEAM_DOMAIN must match https://<team>.cloudflareaccess.com");
  }
  return normalized;
}

function parseAudience(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v).trim()).filter(Boolean);
        }
      } catch {
        // fall through to CSV
      }
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function parsePrefixes(value: unknown): string[] {
  if (Array.isArray(value)) {
    const prefixes = value.map((v) => String(v).trim()).filter(Boolean);
    return prefixes.length > 0 ? prefixes : ["/admin", "/api/admin"];
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        const prefixes = parsed.map((v) => String(v).trim()).filter(Boolean);
        return prefixes.length > 0 ? prefixes : ["/admin", "/api/admin"];
      }
    } catch {
      const prefixes = value.split(",").map((s) => s.trim()).filter(Boolean);
      return prefixes.length > 0 ? prefixes : ["/admin", "/api/admin"];
    }
  }
  return ["/admin", "/api/admin"];
}

let runtimeConfigCache: CfAccessConfig | null = null;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isLoopbackTeamDomain(raw: string): boolean {
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

/** Resolve team domain; loopback allowed only in test (mock JWKS). */
export function resolveTeamDomainFromRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isLoopbackTeamDomain(trimmed) && process.env.NODE_ENV === "test") {
    return trimmed.replace(/\/$/, "");
  }
  return normalizeCfAccessTeamDomain(trimmed);
}

/** Build a resolved CF Access config from explicit field values (form save / validation). */
export function buildCfAccessConfigFromFields(input: {
  enabled: boolean;
  teamDomainRaw: string;
  audience: string[];
  protectedPrefixes: string[];
}): CfAccessConfig {
  const prefixes =
    input.protectedPrefixes.length > 0 ? input.protectedPrefixes : ["/admin", "/api/admin"];
  const teamDomain = input.teamDomainRaw ? resolveTeamDomainFromRaw(input.teamDomainRaw) : "";
  return {
    enabled: input.enabled,
    teamDomain,
    audience: input.audience,
    protectedPrefixes: prefixes,
    jwksUri: teamDomain ? `${teamDomain}/cdn-cgi/access/certs` : "",
  };
}

/** Invalidate process-lifetime CF config cache (after admin save). */
export function clearCfAccessRuntimeConfigCache(): void {
  runtimeConfigCache = null;
}

/** Resolved CF Access config with process-lifetime cache (restart-bound trust). */
export async function getCfAccessConfigCached(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<CfAccessConfig> {
  if (runtimeConfigCache) return runtimeConfigCache;
  runtimeConfigCache = await getCfAccessConfig(prisma);
  return runtimeConfigCache;
}

/** Resolved Cloudflare Access config (env lock → DB → default). */
export async function getCfAccessConfig(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<CfAccessConfig> {
  const enabled = Boolean(await getSetting<boolean>(prisma, SETTING_CF_ACCESS_ENABLED));
  const teamRaw = String(await getSetting<string>(prisma, SETTING_CF_ACCESS_TEAM_DOMAIN));
  const audience = parseAudience(await getSetting(prisma, SETTING_CF_ACCESS_AUD));
  const protectedPrefixes = parsePrefixes(
    await getSetting(prisma, SETTING_CF_ACCESS_PROTECTED_PREFIXES),
  );

  let teamDomain = "";
  if (teamRaw.trim()) {
    const trimmed = teamRaw.trim().replace(/\/$/, "");
    teamDomain = enabled ? resolveTeamDomainFromRaw(trimmed) : trimmed;
  }

  return {
    enabled,
    teamDomain,
    audience,
    protectedPrefixes,
    jwksUri: teamDomain ? `${teamDomain}/cdn-cgi/access/certs` : "",
  };
}

/** Boot-time validation for CF Access config. */
export function validateCfAccessBootConfigFromResolved(config: CfAccessConfig): void {
  if (!config.enabled) return;
  if (!config.teamDomain) {
    throw new Error(
      "CF_ACCESS_TEAM_DOMAIN is required when CF_ACCESS_ENABLED=true (full issuer URL: https://<team>.cloudflareaccess.com)",
    );
  }
  if (config.audience.length === 0) {
    throw new Error("CF_ACCESS_AUD is required when CF_ACCESS_ENABLED=true (at least one audience tag)");
  }
  if (config.protectedPrefixes.length === 0) {
    throw new Error(
      "CF_ACCESS_PROTECTED_PREFIXES must not be empty when CF_ACCESS_ENABLED=true",
    );
  }
  console.warn(
    "WARNING: CF_ACCESS_ENABLED=true; ensure origin is reachable only via Cloudflare Tunnel/firewall (see deployment-cloudflare-access.md)",
  );
}

/** Resolve team domain for JWKS test — allow loopback mocks in test only. */
export function resolveCfAccessTeamDomainForConnection(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return resolveTeamDomainFromRaw(trimmed);
}

export function pathMatchesCfProtectedPrefix(path: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}
