/**
 * Authenticated Settings Health check (ADR 0037).
 * Extends ADR 0026 ops probes with a grouped staff-facing report + optional live checks.
 * Does not change `/healthz` or `/readyz` contracts.
 */

import type { Context } from "hono";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants, unlink, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, type PrismaClient } from "@admitto/db";
import {
  canManageInstance,
  findEnabledOidcProviders,
  getCfAccessConfig,
  listOidcProviders,
  testCfAccessConnection,
  testOidcConnection,
} from "@admitto/auth";
import { describeMailConfigForOrg, resolveMailConfigForOrg } from "@admitto/mailer-config";
import { probeMailTransport, type MailProbeResult } from "@admitto/mailer";
import { isLocationMapsEnabled, type GeocodingProvider } from "@admitto/location";
import { resolveUploadDir } from "@admitto/storage";
import type { HealthOverallStatus, HealthRowStatus } from "@admitto/shared";
import { collectSetupChecks, type SetupCheckResult } from "./setup-checks-routes.js";
import { collectGauges, checkMailer, checkDatabase } from "../ops/readyz.js";
import { resolveProductVersion } from "../ops/product-version.js";
import { readAdminBuildMeta } from "./admin-build-meta.js";
import { resolveInstanceOrganizationId } from "./instance-org.js";
import { resolveGeocodingConfig, resolveMapTileConfig } from "../maps/config.js";
import type { RateLimitStore } from "../rate-limit/types.js";

export type { HealthOverallStatus, HealthRowStatus };

export type HealthDetail = { key: string; value: string };

export type HealthCheckRow = {
  id: string;
  label: string;
  status: HealthRowStatus;
  summary: string;
  details: HealthDetail[];
};

export type HealthGroupId = "core" | "external";

export type HealthGroup = {
  id: HealthGroupId;
  label: string;
  subtitle: string;
  status: HealthOverallStatus;
  checks: HealthCheckRow[];
};

export type HealthReport = {
  generated_at: string;
  version: string;
  commit: string;
  overall: HealthOverallStatus;
  groups: HealthGroup[];
};

/** Queue depth that flips mail_delivery_queue to degraded (ADR 0037). */
export const MAIL_QUEUE_DEGRADED_THRESHOLD = 50;

/** Latency that flips address_lookup to degraded on a live Nominatim probe (ADR 0037). */
export const ADDRESS_LOOKUP_DEGRADED_MS = 1500;

const SENDING_PROVIDERS = new Set(["smtp", "graph", "powerautomate"]);

export type CollectAdminHealthDeps = {
  db: PrismaClient;
  rateLimitStore: RateLimitStore;
  geocodingProvider?: GeocodingProvider;
  injectedBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Admin SPA dist root to read `build-meta.json` from. Defaults to the same candidates
   * `staff-spa` uses. Tests pass an empty temp dir so ambient dist does not leak in.
   */
  adminDistRoot?: string;
  /** When true, run Nominatim + identity provider + Cloudflare Access + mail live probes (POST /health/live only). */
  live?: boolean;
  now?: () => Date;
  /** Injectable mail transport probe (tests); defaults to {@link probeMailTransport}. */
  probeMail?: (config: unknown) => Promise<MailProbeResult>;
  /** Injectable org mail config resolver (tests); defaults to {@link resolveMailConfigForOrg}. */
  resolveOrgMailConfig?: typeof resolveMailConfigForOrg;
};

export type ResolveHealthCommitOpts = {
  /** Override SPA dist root (tests). Omit to scan default admin dist candidates. */
  adminDistRoot?: string;
  /** Injectable git HEAD reader (tests); defaults to `git rev-parse HEAD`. */
  gitHead?: () => string;
};

/**
 * Short commit for health dumps: served admin SPA build first (matches sidebar), then
 * `GIT_COMMIT` (Docker), then live `git rev-parse HEAD`.
 */
export function resolveHealthCommit(
  env: NodeJS.ProcessEnv = process.env,
  opts: ResolveHealthCommitOpts = {},
): string {
  const meta = readAdminBuildMeta(opts.adminDistRoot);
  if (meta && meta.commit !== "unknown") return meta.commit;

  const raw = env.GIT_COMMIT?.trim();
  if (raw) return raw.slice(0, 7);

  try {
    const sha = (
      opts.gitHead ??
      (() => {
        // Trusted build/runtime tooling; same pattern as apps/admin/build-meta.ts (Sonar S4036).
        // Bare "git" resolves via PATH like the rest of the monorepo toolchain - not untrusted input.
        return execSync("git rev-parse HEAD", { cwd: process.cwd(), encoding: "utf8" }); // NOSONAR - see comment above
      })
    )().trim();
    return sha ? sha.slice(0, 7) : "unknown";
  } catch {
    return "unknown";
  }
}

/** Product version for health dumps: served SPA build first, else root package.json. */
export function resolveHealthVersion(opts: ResolveHealthCommitOpts = {}): string {
  const meta = readAdminBuildMeta(opts.adminDistRoot);
  return meta?.version ?? resolveProductVersion();
}

/** Worst-of among statuses that affect overall health (ADR 0037). */
export function worstHealthStatus(statuses: HealthRowStatus[]): HealthOverallStatus {
  let worst: HealthOverallStatus = "ok";
  for (const s of statuses) {
    if (s === "planned" || s === "not_configured") continue;
    if (s === "down") return "down";
    if (s === "degraded") worst = "degraded";
  }
  return worst;
}

function detailsFromEntries(entries: Array<[string, string | undefined | null]>): HealthDetail[] {
  return entries
    .filter((e): e is [string, string] => e[1] != null && e[1] !== "")
    .map(([key, value]) => ({ key, value }));
}

/** Host/origin only - strips credentials and query (MAP_TILE_URL may carry api keys). */
export function safeEndpointDisplay(raw: string): string | undefined {
  const expanded = raw
    .replaceAll("{s}", "a")
    .replaceAll("{z}", "0")
    .replaceAll("{x}", "0")
    .replaceAll("{y}", "0")
    .replaceAll("{r}", "");
  try {
    const u = new URL(expanded);
    return u.origin;
  } catch {
    return undefined;
  }
}

function mailProviderLabel(provider: string | null | undefined): string {
  switch (provider) {
    case "smtp":
      return "Email sending, SMTP";
    case "graph":
      return "Email sending, Microsoft Graph";
    case "powerautomate":
      return "Email sending, Power Automate";
    case "export_only":
      return "Email sending, Export only";
    default:
      return "Email sending";
  }
}

export function mapTilesServiceLabel(tileUrl: string): string {
  const endpoint = safeEndpointDisplay(tileUrl);
  if (!endpoint) return "Map tiles";
  const host = new URL(endpoint).hostname;
  if (host.includes("openstreetmap")) return "Map tiles, OpenStreetMap";
  if (host.includes("carto")) return "Map tiles, CARTO";
  return `Map tiles, ${host}`;
}

function identityProtocolLabel(providerType: string): string {
  switch (providerType) {
    case "oidc":
      return "OIDC";
    case "saml":
      return "SAML";
    default:
      return providerType.replaceAll("_", " ").toUpperCase();
  }
}

function identityProviderRowLabel(provider: {
  provider_type: string;
  display_name: string;
}): string {
  return `Identity provider, ${identityProtocolLabel(provider.provider_type)} - ${provider.display_name}`;
}

async function readPostgresEngine(db: PrismaClient): Promise<string | undefined> {
  try {
    const rows = await db.$queryRaw<Array<{ version: string }>>(Prisma.sql`SELECT version()`);
    const raw = rows[0]?.version?.trim();
    if (!raw) return undefined;
    const short = raw.match(/^PostgreSQL\s+[\d.]+/i);
    return short?.[0] ?? raw.slice(0, 48);
  } catch {
    return undefined;
  }
}

const LATENCY_MS_IN_DETAIL = /\((\d+)\s*ms\)/;

function parseLatencyMsFromDetail(detail: string): string | undefined {
  return LATENCY_MS_IN_DETAIL.exec(detail)?.[1];
}

function resolveDatabaseLatencyMs(
  check: SetupCheckResult,
  extras?: { latencyMs?: number },
): string | undefined {
  const fromSetup = parseLatencyMsFromDetail(check.detail);
  const setupMs = fromSetup != null ? Number(fromSetup) : undefined;
  const probeMs = extras?.latencyMs;
  // When setup flagged the DB as slow, keep (or take the max of) that latency so a faster
  // parallel checkDatabase probe cannot under-report "Responding slowly · N ms".
  if (check.warn) {
    const candidates = [setupMs, probeMs].filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n),
    );
    if (candidates.length === 0) return undefined;
    return String(Math.max(...candidates));
  }
  if (probeMs != null && Number.isFinite(probeMs)) return String(probeMs);
  return fromSetup;
}

function setupToDatabaseRow(
  check: SetupCheckResult,
  checkedAt: string,
  extras?: { latencyMs?: number; engine?: string },
): HealthCheckRow {
  const label = "Database";
  const latency = resolveDatabaseLatencyMs(check, extras);
  if (!check.ok && check.reason === "unreachable") {
    return {
      id: "database",
      label,
      status: "down",
      summary: "Not reachable",
      details: detailsFromEntries([
        ["status", "down"],
        ["engine", extras?.engine],
        ["latency_ms", latency],
        ["last_checked", checkedAt],
      ]),
    };
  }
  if (!check.ok && check.reason === "migrations_pending") {
    return {
      id: "database",
      label,
      status: "down",
      summary: "Schema update pending",
      details: detailsFromEntries([
        ["status", "down"],
        ["engine", extras?.engine],
        ["migrations", "pending"],
        ["latency_ms", latency],
        ["last_checked", checkedAt],
      ]),
    };
  }
  if (check.warn) {
    return {
      id: "database",
      label,
      status: "degraded",
      summary: latency ? `Responding slowly · ${latency} ms` : "Responding slowly",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["engine", extras?.engine],
        ["migrations", "current"],
        ["latency_ms", latency],
        ["last_checked", checkedAt],
      ]),
    };
  }
  return {
    id: "database",
    label,
    status: "ok",
    summary: "Connected",
    details: detailsFromEntries([
      ["status", "ok"],
      ["engine", extras?.engine],
      ["migrations", "current"],
      ["latency_ms", latency],
      ["last_checked", checkedAt],
    ]),
  };
}

function setupToRedisRow(check: SetupCheckResult, checkedAt: string): HealthCheckRow {
  const inMemory =
    check.detail.toLowerCase().includes("in-memory") ||
    check.detail.toLowerCase().includes("no redis");
  const label = "Rate-limit storage";
  if (!check.ok) {
    return {
      id: "rate_limit_storage",
      label,
      status: "down",
      summary: "Not reachable",
      details: detailsFromEntries([
        ["status", "down"],
        ["mode", "redis"],
        ["last_checked", checkedAt],
      ]),
    };
  }
  if (check.warn) {
    const latencyMs = parseLatencyMsFromDetail(check.detail);
    return {
      id: "rate_limit_storage",
      label,
      status: "degraded",
      summary: latencyMs
        ? `Responding slowly · ${latencyMs} ms`
        : "Responding slowly",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["mode", inMemory ? "in-memory" : "redis"],
        ["latency_ms", latencyMs],
        ["last_checked", checkedAt],
      ]),
    };
  }
  const latencyMs = parseLatencyMsFromDetail(check.detail);
  return {
    id: "rate_limit_storage",
    label,
    status: "ok",
    summary: inMemory ? "Connected (in-memory)" : "Connected",
    details: detailsFromEntries([
      ["status", "ok"],
      ["mode", inMemory ? "in-memory" : "redis"],
      ["latency_ms", latencyMs],
      ["last_checked", checkedAt],
    ]),
  };
}

function setupToEncryptionRow(check: SetupCheckResult, checkedAt: string): HealthCheckRow {
  const label = "Data encryption";
  if (!check.ok) {
    return {
      id: "data_encryption",
      label,
      status: "down",
      summary: "Not configured",
      details: detailsFromEntries([
        ["status", "down"],
        ["algorithm", "AES-256-GCM"],
        ["last_checked", checkedAt],
      ]),
    };
  }
  // Setup check returns ok:true without a key in development/test ("Optional in development").
  if (/optional in development/i.test(check.detail)) {
    return {
      id: "data_encryption",
      label,
      status: "not_configured",
      summary: "Optional in development",
      details: detailsFromEntries([
        ["status", "not_configured"],
        ["algorithm", "AES-256-GCM"],
        ["configured", "no"],
        ["last_checked", checkedAt],
      ]),
    };
  }
  return {
    id: "data_encryption",
    label,
    status: "ok",
    summary: "Active",
    details: detailsFromEntries([
      ["status", "ok"],
      ["algorithm", "AES-256-GCM"],
      ["last_checked", checkedAt],
    ]),
  };
}

function setupToInstanceUrlRow(check: SetupCheckResult, checkedAt: string): HealthCheckRow {
  const label = "Instance URL";
  if (!check.ok) {
    return {
      id: "instance_url",
      label,
      status: "down",
      summary: "Not configured",
      details: detailsFromEntries([
        ["status", "down"],
        ["configured", "no"],
        ["last_checked", checkedAt],
      ]),
    };
  }
  if (check.warn) {
    return {
      id: "instance_url",
      label,
      status: "degraded",
      summary: "Optional in development",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["configured", "yes"],
        ["last_checked", checkedAt],
      ]),
    };
  }
  return {
    id: "instance_url",
    label,
    status: "ok",
    summary: "Configured",
    details: detailsFromEntries([
      ["status", "ok"],
      ["configured", "yes"],
      // Superadmin UI expand only. Markdown formatter omits raw URLs.
      ["url", check.detail.startsWith("http") ? check.detail : undefined],
      ["last_checked", checkedAt],
    ]),
  };
}

function mailQueueRow(
  queued: number,
  failedRetryable: number,
  checkedAt: string,
): HealthCheckRow {
  const label = "Mail delivery queue";
  if (queued < 0 || failedRetryable < 0) {
    return {
      id: "mail_delivery_queue",
      label,
      status: "degraded",
      summary: "Could not read queue depth",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["degraded_threshold", String(MAIL_QUEUE_DEGRADED_THRESHOLD)],
        ["last_checked", checkedAt],
      ]),
    };
  }
  // Any retryable failure needs attention, even while other mail is still queued.
  if (failedRetryable > 0) {
    const failures = `${failedRetryable.toLocaleString("en")} retryable failures`;
    const summary =
      queued > 0
        ? `Needs attention · ${queued.toLocaleString("en")} queued · ${failures}`
        : `Queue empty · ${failures}`;
    return {
      id: "mail_delivery_queue",
      label,
      status: "degraded",
      summary,
      details: detailsFromEntries([
        ["status", "degraded"],
        ["queued", String(queued)],
        ["failed_retryable", String(failedRetryable)],
        ["degraded_threshold", String(MAIL_QUEUE_DEGRADED_THRESHOLD)],
        ["last_checked", checkedAt],
      ]),
    };
  }
  if (queued >= MAIL_QUEUE_DEGRADED_THRESHOLD) {
    return {
      id: "mail_delivery_queue",
      label,
      status: "degraded",
      summary: `Falling behind · ${queued.toLocaleString("en")} queued`,
      details: detailsFromEntries([
        ["status", "degraded"],
        ["queued", String(queued)],
        ["failed_retryable", String(failedRetryable)],
        ["degraded_threshold", String(MAIL_QUEUE_DEGRADED_THRESHOLD)],
        ["last_checked", checkedAt],
      ]),
    };
  }
  const summary =
    queued === 0 ? "Queue empty" : `Running · ${queued.toLocaleString("en")} queued`;
  return {
    id: "mail_delivery_queue",
    label,
    status: "ok",
    summary,
    details: detailsFromEntries([
      ["status", "ok"],
      ["queued", String(queued)],
      ["failed_retryable", String(failedRetryable)],
      ["degraded_threshold", String(MAIL_QUEUE_DEGRADED_THRESHOLD)],
      ["last_checked", checkedAt],
    ]),
  };
}

async function emailSendingRow(
  db: PrismaClient,
  env: NodeJS.ProcessEnv,
  checkedAt: string,
  live: boolean,
  probeMail: (config: unknown) => Promise<MailProbeResult>,
  resolveOrgMailConfig: typeof resolveMailConfigForOrg,
): Promise<HealthCheckRow> {
  const envMailer = checkMailer(env);
  try {
    const orgId = await resolveInstanceOrganizationId(db, env);
    const desc = await describeMailConfigForOrg(orgId, db, env);
    const provider = desc.provider.value;
    if (!provider) {
      return {
        id: "email_sending",
        label: "Email sending",
        status: "not_configured",
        summary: "Not configured",
        details: detailsFromEntries([
          ["status", "not_configured"],
          ["configured", "no"],
          ["last_checked", checkedAt],
        ]),
      };
    }
    const label = mailProviderLabel(provider);
    if (provider === "export_only") {
      return {
        id: "email_sending",
        label,
        status: "not_configured",
        summary: "Export only · not sending",
        details: detailsFromEntries([
          ["status", "not_configured"],
          ["provider", "export_only"],
          ["configured", "yes"],
          ["source", desc.provider.source],
          ["last_checked", checkedAt],
        ]),
      };
    }
    if (!SENDING_PROVIDERS.has(provider)) {
      return {
        id: "email_sending",
        label,
        status: "not_configured",
        summary: "Not configured",
        details: detailsFromEntries([
          ["status", "not_configured"],
          ["configured", "no"],
          ["last_checked", checkedAt],
        ]),
      };
    }

    const providerDetail = provider === "powerautomate" ? "power_automate" : provider;
    const configuredDetails = detailsFromEntries([
      ["status", "ok"],
      ["provider", providerDetail],
      ["source", desc.provider.source],
      ["last_checked", checkedAt],
    ]);

    if (!live) {
      return {
        id: "email_sending",
        label,
        status: "ok",
        summary: "Configured",
        details: configuredDetails,
      };
    }

    // Power Automate has no non-sending probe (supportsTestConnection: false).
    if (provider === "powerautomate") {
      return {
        id: "email_sending",
        label,
        status: "ok",
        summary: "Configured",
        details: detailsFromEntries([
          ["status", "ok"],
          ["provider", providerDetail],
          ["source", desc.provider.source],
          ["live_check", "skipped"],
          ["last_checked", checkedAt],
        ]),
      };
    }

    const mailConfig = await resolveOrgMailConfig(orgId, db, env);
    const probe = await probeMail(mailConfig);
    if (!probe.ok) {
      return {
        id: "email_sending",
        label,
        status: "down",
        summary: "Unreachable",
        details: detailsFromEntries([
          ["status", "down"],
          ["provider", providerDetail],
          ["source", desc.provider.source],
          ["live_check", "failed"],
          ["last_checked", checkedAt],
        ]),
      };
    }
    if (probe.skipped) {
      return {
        id: "email_sending",
        label,
        status: "ok",
        summary: "Configured",
        details: detailsFromEntries([
          ["status", "ok"],
          ["provider", providerDetail],
          ["source", desc.provider.source],
          ["live_check", "skipped"],
          ["last_checked", checkedAt],
        ]),
      };
    }
    return {
      id: "email_sending",
      label,
      status: "ok",
      summary: "Reachable",
      details: detailsFromEntries([
        ["status", "ok"],
        ["provider", providerDetail],
        ["source", desc.provider.source],
        ["live_check", "ok"],
        ["last_checked", checkedAt],
      ]),
    };
  } catch {
    // Passive: env mail still counts as configured when org lookup fails.
    // Live: do not greenwash — effective config could not be resolved/probed.
    if (
      !live &&
      envMailer.configured &&
      envMailer.provider &&
      envMailer.provider !== "export_only"
    ) {
      return {
        id: "email_sending",
        label: mailProviderLabel(envMailer.provider),
        status: "ok",
        summary: "Configured",
        details: detailsFromEntries([
          ["status", "ok"],
          ["provider", envMailer.provider],
          ["source", "env"],
          ["last_checked", checkedAt],
        ]),
      };
    }
    return {
      id: "email_sending",
      label: "Email sending",
      status: "degraded",
      summary: "Could not read mail settings",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["configured", "no"],
        ["reason", "lookup_failed"],
        ["last_checked", checkedAt],
      ]),
    };
  }
}

async function identityProviderRows(
  db: PrismaClient,
  live: boolean,
  checkedAt: string,
): Promise<HealthCheckRow[]> {
  const all = await listOidcProviders(db);
  if (all.length === 0) {
    return [
      {
        id: "identity_providers",
        label: "Identity provider",
        status: "not_configured",
        summary: "Not configured",
        details: detailsFromEntries([
          ["status", "not_configured"],
          ["providers", "0"],
          ["last_checked", checkedAt],
        ]),
      },
    ];
  }

  const enabled = await findEnabledOidcProviders(db);
  const enabledIds = new Set(enabled.map((p) => p.id));

  return Promise.all(
    all.map(async (provider) => {
      const id = `identity_provider_${provider.id}`;
      const label = identityProviderRowLabel(provider);
      const endpoint = safeEndpointDisplay(provider.issuer);
      const isEnabled = enabledIds.has(provider.id);

      if (!live || !isEnabled) {
        return {
          id,
          label,
          status: "ok" as const,
          summary: isEnabled ? "Configured · enabled" : "Configured · disabled",
          details: detailsFromEntries([
            ["status", "ok"],
            ["protocol", identityProtocolLabel(provider.provider_type)],
            ["display_name", provider.display_name],
            ["enabled", isEnabled ? "yes" : "no"],
            ["endpoint", endpoint],
            ["last_checked", checkedAt],
          ]),
        };
      }

      const result = await testOidcConnection({
        issuer: provider.issuer,
        authorization_endpoint: provider.authorization_endpoint,
        token_endpoint: provider.token_endpoint,
        jwks_uri: provider.jwks_uri,
        ...(provider.userinfo_endpoint ? { userinfo_endpoint: provider.userinfo_endpoint } : {}),
      });

      if (!result.ok) {
        return {
          id,
          label,
          status: "down" as const,
          summary: "Connection test failed",
          details: detailsFromEntries([
            ["status", "down"],
            ["protocol", identityProtocolLabel(provider.provider_type)],
            ["display_name", provider.display_name],
            ["enabled", "yes"],
            ["endpoint", endpoint],
            ["live_check", "failed"],
            ["last_checked", checkedAt],
          ]),
        };
      }

      return {
        id,
        label,
        status: "ok" as const,
        summary: "Reachable",
        details: detailsFromEntries([
          ["status", "ok"],
          ["protocol", identityProtocolLabel(provider.provider_type)],
          ["display_name", provider.display_name],
          ["enabled", "yes"],
          ["endpoint", endpoint],
          ["live_check", "ok"],
          ["last_checked", checkedAt],
        ]),
      };
    }),
  );
}

async function cloudflareAccessRow(
  db: PrismaClient,
  live: boolean,
  checkedAt: string,
): Promise<HealthCheckRow> {
  const label = "Cloudflare Access";
  const config = await getCfAccessConfig(db);
  const endpoint = config.teamDomain ? safeEndpointDisplay(config.teamDomain) : undefined;

  if (!config.teamDomain && !config.enabled) {
    return {
      id: "cloudflare_access",
      label,
      status: "not_configured",
      summary: "Not configured",
      details: detailsFromEntries([
        ["status", "not_configured"],
        ["configured", "no"],
        ["last_checked", checkedAt],
      ]),
    };
  }

  if (!config.enabled) {
    return {
      id: "cloudflare_access",
      label,
      status: "ok",
      summary: "Configured · disabled",
      details: detailsFromEntries([
        ["status", "ok"],
        ["enabled", "no"],
        ["endpoint", endpoint],
        ["last_checked", checkedAt],
      ]),
    };
  }

  if (!live) {
    return {
      id: "cloudflare_access",
      label,
      status: "ok",
      summary: "Configured · enabled",
      details: detailsFromEntries([
        ["status", "ok"],
        ["enabled", "yes"],
        ["endpoint", endpoint],
        ["audiences", String(config.audience.length)],
        ["last_checked", checkedAt],
      ]),
    };
  }

  const result = await testCfAccessConnection({ teamDomain: config.teamDomain });
  if (!result.ok) {
    return {
      id: "cloudflare_access",
      label,
      status: "down",
      summary: "Connection test failed",
      details: detailsFromEntries([
        ["status", "down"],
        ["enabled", "yes"],
        ["endpoint", endpoint],
        ["live_check", "failed"],
        ["last_checked", checkedAt],
      ]),
    };
  }

  return {
    id: "cloudflare_access",
    label,
    status: "ok",
    summary: "Reachable",
    details: detailsFromEntries([
      ["status", "ok"],
      ["enabled", "yes"],
      ["endpoint", endpoint],
      ["audiences", String(config.audience.length)],
      ["live_check", "ok"],
      ["last_checked", checkedAt],
    ]),
  };
}

async function addressLookupRow(
  geocodingProvider: GeocodingProvider | undefined,
  live: boolean,
  env: NodeJS.ProcessEnv,
  checkedAt: string,
): Promise<HealthCheckRow> {
  const geo = resolveGeocodingConfig(env);
  const endpoint = safeEndpointDisplay(geo.baseUrl);
  const label = "Address lookup, Nominatim";

  if (!isLocationMapsEnabled(env)) {
    return {
      id: "address_lookup",
      label,
      status: "not_configured",
      summary: "Maps disabled",
      details: detailsFromEntries([
        ["status", "not_configured"],
        ["provider", "nominatim"],
        ["endpoint", endpoint],
        ["last_checked", checkedAt],
      ]),
    };
  }

  if (!live || !geocodingProvider) {
    return {
      id: "address_lookup",
      label,
      status: "ok",
      summary: "Provider available",
      details: detailsFromEntries([
        ["status", "ok"],
        ["provider", geocodingProvider?.name ?? "nominatim"],
        ["endpoint", endpoint],
        ["last_checked", checkedAt],
      ]),
    };
  }

  const started = Date.now();
  try {
    await geocodingProvider.search("Warsaw");
    const latencyMs = Date.now() - started;
    const degraded = latencyMs >= ADDRESS_LOOKUP_DEGRADED_MS;
    return {
      id: "address_lookup",
      label,
      status: degraded ? "degraded" : "ok",
      summary: degraded ? `Slow to respond · ${latencyMs} ms` : "Reachable",
      details: detailsFromEntries([
        ["status", degraded ? "degraded" : "ok"],
        ["provider", geocodingProvider.name],
        ["endpoint", endpoint],
        ["latency_ms", String(latencyMs)],
        ["live_check", "ok"],
        ["last_checked", checkedAt],
      ]),
    };
  } catch {
    return {
      id: "address_lookup",
      label,
      status: "down",
      summary: "Unreachable",
      details: detailsFromEntries([
        ["status", "down"],
        ["provider", geocodingProvider.name],
        ["endpoint", endpoint],
        ["live_check", "failed"],
        ["last_checked", checkedAt],
      ]),
    };
  }
}

function mapTilesRow(env: NodeJS.ProcessEnv, checkedAt: string): HealthCheckRow {
  const tiles = resolveMapTileConfig(env);
  const endpoint = safeEndpointDisplay(tiles.tileUrl);
  const label = mapTilesServiceLabel(tiles.tileUrl);

  if (!tiles.enabled) {
    return {
      id: "map_tiles",
      label,
      status: "not_configured",
      summary: "Maps disabled",
      details: detailsFromEntries([
        ["status", "not_configured"],
        ["endpoint", endpoint],
        ["max_zoom", String(tiles.maxZoom)],
        ["last_checked", checkedAt],
      ]),
    };
  }

  return {
    id: "map_tiles",
    label,
    status: "ok",
    summary: "Configured",
    details: detailsFromEntries([
      ["status", "ok"],
      ["endpoint", endpoint],
      ["max_zoom", String(tiles.maxZoom)],
      // resolveMapTileConfig always supplies a non-empty attribution (env or OSM default).
      ["attribution", "set"],
      ["last_checked", checkedAt],
    ]),
  };
}

function plannedRow(id: string, label: string, summary: string): HealthCheckRow {
  return {
    id,
    label,
    status: "planned",
    summary,
    details: detailsFromEntries([
      ["status", "planned"],
      ["availability", "later_release"],
    ]),
  };
}

/**
 * Local branding upload volume (`UPLOAD_DIR` / `@admitto/storage`).
 * Passive: path must be an existing directory that is readable, writable, and searchable
 * (`R_OK|W_OK|X_OK`). Missing root is degraded (adapter `mkdir` on first put), not an outage.
 * Live: write+unlink a tiny probe file under that root.
 */
export async function fileStorageRow(
  env: NodeJS.ProcessEnv,
  checkedAt: string,
  live: boolean,
): Promise<HealthCheckRow> {
  const label = "File storage";
  const providerRaw = (env.STORAGE_PROVIDER ?? "local").trim().toLowerCase() || "local";

  if (providerRaw === "s3") {
    return {
      id: "file_storage",
      label,
      status: "degraded",
      summary: "S3 not implemented",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["provider", "s3"],
        ["reason", "not_implemented"],
        ["last_checked", checkedAt],
      ]),
    };
  }

  if (providerRaw !== "local") {
    return {
      id: "file_storage",
      label,
      status: "degraded",
      summary: `Unknown provider (${providerRaw})`,
      details: detailsFromEntries([
        ["status", "degraded"],
        ["provider", providerRaw],
        ["reason", "unknown_provider"],
        ["last_checked", checkedAt],
      ]),
    };
  }

  const uploadPath = resolveUploadDir(env);
  try {
    // Path from env / cwd only (operator-controlled), not request input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const st = await stat(uploadPath);
    if (!st.isDirectory()) {
      return {
        id: "file_storage",
        label,
        status: "down",
        summary: "Not a directory",
        details: detailsFromEntries([
          ["status", "down"],
          ["provider", "local"],
          ["path", uploadPath],
          ["writable", "no"],
          ["reason", "not_a_directory"],
          ["last_checked", checkedAt],
        ]),
      };
    }
    // X_OK: directory must be searchable so children can be created (Unix).
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await access(uploadPath, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // LocalStorageAdapter.put mkdir(recursive) on first branding save - not an outage.
      return {
        id: "file_storage",
        label,
        status: "degraded",
        summary: "Missing directory · created on first upload",
        details: detailsFromEntries([
          ["status", "degraded"],
          ["provider", "local"],
          ["path", uploadPath],
          ["writable", "unknown"],
          ["reason", "missing_directory"],
          ["last_checked", checkedAt],
        ]),
      };
    }
    return {
      id: "file_storage",
      label,
      status: "down",
      summary: "Not writable",
      details: detailsFromEntries([
        ["status", "down"],
        ["provider", "local"],
        ["path", uploadPath],
        ["writable", "no"],
        ["reason", "not_writable"],
        ["last_checked", checkedAt],
      ]),
    };
  }

  if (live) {
    const probePath = join(uploadPath, `.admitto-health-probe-${randomUUID()}`);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(probePath, "ok");
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await unlink(probePath);
    } catch {
      return {
        id: "file_storage",
        label,
        status: "degraded",
        summary: "Write probe failed",
        details: detailsFromEntries([
          ["status", "degraded"],
          ["provider", "local"],
          ["path", uploadPath],
          ["writable", "uncertain"],
          ["reason", "write_probe_failed"],
          ["last_checked", checkedAt],
        ]),
      };
    }
  }

  return {
    id: "file_storage",
    label,
    status: "ok",
    summary: "Connected",
    details: detailsFromEntries([
      ["status", "ok"],
      ["provider", "local"],
      ["path", uploadPath],
      ["writable", "yes"],
      ["last_checked", checkedAt],
    ]),
  };
}

function buildGroup(
  id: HealthGroupId,
  label: string,
  subtitle: string,
  checks: HealthCheckRow[],
): HealthGroup {
  return {
    id,
    label,
    subtitle,
    status: worstHealthStatus(checks.map((c) => c.status)),
    checks,
  };
}

/** Build the Settings Health report (passive by default; live probes when `live`). */
export async function collectAdminHealth(deps: CollectAdminHealthDeps): Promise<HealthReport> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const checkedAt = generatedAt;
  const live = Boolean(deps.live);
  const probeMail = deps.probeMail ?? probeMailTransport;
  const resolveOrgMailConfig = deps.resolveOrgMailConfig ?? resolveMailConfigForOrg;

  const setupFallback: Awaited<ReturnType<typeof collectSetupChecks>> = {
    database: { ok: false, reason: "unreachable", detail: "Database check unavailable" },
    redis: { ok: false, detail: "Rate-limit storage check unavailable" },
    encryption: { ok: false, detail: "Encryption check unavailable" },
    base_url: { ok: false, detail: "Instance URL check unavailable" },
  };
  const gaugesFallback = {
    email_deliveries_queued: -1,
    email_deliveries_failed_retryable: -1,
  };
  const idpFallback: HealthCheckRow[] = [
    {
      id: "identity_providers",
      label: "Identity provider",
      status: "degraded",
      summary: "Could not load identity providers",
      details: detailsFromEntries([
        ["status", "degraded"],
        ["reason", "lookup_failed"],
        ["last_checked", checkedAt],
      ]),
    },
  ];
  const cfFallback: HealthCheckRow = {
    id: "cloudflare_access",
    label: "Cloudflare Access",
    status: "degraded",
    summary: "Could not load Cloudflare Access settings",
    details: detailsFromEntries([
      ["status", "degraded"],
      ["reason", "lookup_failed"],
      ["last_checked", checkedAt],
    ]),
  };
  const addressFallback: HealthCheckRow = {
    id: "address_lookup",
    label: "Address lookup, Nominatim",
    status: "degraded",
    summary: "Could not evaluate address lookup",
    details: detailsFromEntries([
      ["status", "degraded"],
      ["reason", "lookup_failed"],
      ["last_checked", checkedAt],
    ]),
  };

  const [setup, gauges, email, idpRows, cfAccess, address, dbProbe, engine, fileStorage] =
    await Promise.all([
      collectSetupChecks(deps.db, deps.rateLimitStore, deps.injectedBaseUrl).catch(
        () => setupFallback,
      ),
      collectGauges(deps.db).catch(() => gaugesFallback),
      emailSendingRow(deps.db, env, checkedAt, live, probeMail, resolveOrgMailConfig),
      identityProviderRows(deps.db, live, checkedAt).catch(() => idpFallback),
      cloudflareAccessRow(deps.db, live, checkedAt).catch(() => cfFallback),
      addressLookupRow(deps.geocodingProvider, live, env, checkedAt).catch(() => addressFallback),
      checkDatabase(deps.db).catch(() => ({ status: "down" as const, latency_ms: 0 })),
      readPostgresEngine(deps.db),
      fileStorageRow(env, checkedAt, live),
    ]);

  const coreChecks: HealthCheckRow[] = [
    setupToDatabaseRow(setup.database, checkedAt, {
      latencyMs: dbProbe.latency_ms,
      engine,
    }),
    setupToRedisRow(setup.redis, checkedAt),
    setupToEncryptionRow(setup.encryption, checkedAt),
    mailQueueRow(gauges.email_deliveries_queued, gauges.email_deliveries_failed_retryable, checkedAt),
    setupToInstanceUrlRow(setup.base_url, checkedAt),
    fileStorage,
  ];

  const externalChecks: HealthCheckRow[] = [
    email,
    plannedRow(
      "wallet_passes",
      "Wallet passes, PassCreator",
      "Coming in v0.6 · Apple & Google Wallet",
    ),
    address,
    mapTilesRow(env, checkedAt),
    plannedRow("weather", "Weather, Open-Meteo", "Coming in a later release"),
    ...idpRows,
    cfAccess,
  ];

  const groups = [
    buildGroup("core", "Core infrastructure", "Owned and run by this instance", coreChecks),
    buildGroup(
      "external",
      "External integrations",
      "Third-party APIs this instance depends on",
      externalChecks,
    ),
  ];

  return {
    generated_at: generatedAt,
    version: resolveHealthVersion({ adminDistRoot: deps.adminDistRoot }),
    commit: resolveHealthCommit(env, { adminDistRoot: deps.adminDistRoot }),
    overall: worstHealthStatus(groups.flatMap((g) => g.checks.map((c) => c.status))),
    groups,
  };
}

/** GET /api/admin/health: passive report for Settings → Health check. */
export async function handleGetAdminHealth(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  opts?: {
    geocodingProvider?: GeocodingProvider;
    injectedBaseUrl?: string;
    /** Same dist root passed to `createStaffSpaHandlers` (custom deploy / tests). */
    adminDistRoot?: string;
  },
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const report = await collectAdminHealth({
    db,
    rateLimitStore,
    geocodingProvider: opts?.geocodingProvider,
    injectedBaseUrl: opts?.injectedBaseUrl,
    adminDistRoot: opts?.adminDistRoot,
    live: false,
  });
  return c.json(report, 200);
}

/** POST /api/admin/health/live: same report with on-demand live probes (ADR 0037). */
export async function handlePostAdminHealthLive(
  c: Context,
  db: PrismaClient,
  rateLimitStore: RateLimitStore,
  opts?: {
    geocodingProvider?: GeocodingProvider;
    injectedBaseUrl?: string;
    /** Same dist root passed to `createStaffSpaHandlers` (custom deploy / tests). */
    adminDistRoot?: string;
  },
): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const report = await collectAdminHealth({
    db,
    rateLimitStore,
    geocodingProvider: opts?.geocodingProvider,
    injectedBaseUrl: opts?.injectedBaseUrl,
    adminDistRoot: opts?.adminDistRoot,
    live: true,
  });
  return c.json(report, 200);
}
