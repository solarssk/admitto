import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

const {
  collectSetupChecks,
  collectGauges,
  checkMailer,
  describeMailConfigForOrg,
  resolveInstanceOrganizationId,
  listOidcProviders,
  findEnabledOidcProviders,
  testOidcConnection,
  getCfAccessConfig,
  testCfAccessConnection,
  resolveProductVersion,
  isLocationMapsEnabled,
} = vi.hoisted(() => ({
  collectSetupChecks: vi.fn(),
  collectGauges: vi.fn(),
  checkMailer: vi.fn(),
  describeMailConfigForOrg: vi.fn(),
  resolveInstanceOrganizationId: vi.fn(),
  listOidcProviders: vi.fn(),
  findEnabledOidcProviders: vi.fn(),
  testOidcConnection: vi.fn(),
  getCfAccessConfig: vi.fn(),
  testCfAccessConnection: vi.fn(),
  resolveProductVersion: vi.fn(() => "0.4.13"),
  isLocationMapsEnabled: vi.fn(() => true),
}));

vi.mock("../../src/admin/setup-checks-routes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/setup-checks-routes.js")>();
  return { ...actual, collectSetupChecks };
});
vi.mock("../../src/ops/readyz.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ops/readyz.js")>();
  return { ...actual, collectGauges, checkMailer };
});
vi.mock("../../src/ops/product-version.js", () => ({ resolveProductVersion }));
vi.mock("../../src/admin/instance-org.js", () => ({ resolveInstanceOrganizationId }));
vi.mock("@admitto/mailer-config", () => ({ describeMailConfigForOrg }));
vi.mock("@admitto/location", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/location")>();
  return { ...actual, isLocationMapsEnabled };
});
vi.mock("@admitto/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/auth")>();
  return {
    ...actual,
    listOidcProviders,
    findEnabledOidcProviders,
    testOidcConnection,
    getCfAccessConfig,
    testCfAccessConnection,
    canManageInstance: vi.fn(async () => true),
  };
});

import {
  collectAdminHealth,
  MAIL_QUEUE_DEGRADED_THRESHOLD,
  resolveHealthCommit,
  safeEndpointDisplay,
  worstHealthStatus,
} from "../../src/admin/health-check-routes.js";

const okSetup = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Redis OK (2 ms)" },
  encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

describe("worstHealthStatus", () => {
  it("ignores planned and not_configured", () => {
    expect(worstHealthStatus(["ok", "planned", "not_configured"])).toBe("ok");
  });

  it("prefers down over degraded", () => {
    expect(worstHealthStatus(["degraded", "down", "ok"])).toBe("down");
  });
});

describe("resolveHealthCommit", () => {
  it("shortens GIT_COMMIT", () => {
    expect(resolveHealthCommit({ GIT_COMMIT: "abcdef0123456789" })).toBe("abcdef0");
  });

  it("returns unknown when unset", () => {
    expect(resolveHealthCommit({})).toBe("unknown");
  });
});

describe("safeEndpointDisplay", () => {
  it("strips tile tokens, credentials, and query", () => {
    expect(
      safeEndpointDisplay("https://user:secret@tile.example.com/{z}/{x}/{y}.png?key=abc"),
    ).toBe("https://tile.example.com");
  });
});

describe("collectAdminHealth", () => {
  it("builds core and external groups with planned placeholders", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    checkMailer.mockReturnValue({ configured: true, provider: "smtp" });
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "smtp", source: "organization", locked: false },
    });
    listOidcProviders.mockResolvedValue([]);
    findEnabledOidcProviders.mockResolvedValue([]);
    getCfAccessConfig.mockResolvedValue({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      jwksUri: "",
    });

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: { GIT_COMMIT: "deadbeef" },
      now: () => new Date("2026-08-03T12:00:00.000Z"),
    });

    expect(report.version).toBe("0.4.13");
    expect(report.commit).toBe("deadbee");
    expect(report.overall).toBe("ok");
    expect(report.groups.map((g) => g.id)).toEqual(["core", "external"]);

    const core = report.groups[0]!.checks;
    expect(core.find((c) => c.id === "database")?.label).toBe("Database");
    expect(core.find((c) => c.id === "session_storage")?.label).toBe("Session storage");
    expect(core.find((c) => c.id === "mail_delivery_queue")?.label).toBe("Mail delivery queue");
    expect(core.find((c) => c.id === "file_storage")?.label).toBe("File storage");

    const external = report.groups[1]!.checks;
    expect(external.find((c) => c.id === "email_sending")?.label).toBe("Email sending, SMTP");
    expect(external.find((c) => c.id === "wallet_passes")?.status).toBe("planned");
    expect(external.find((c) => c.id === "wallet_passes")?.label).toBe(
      "Wallet passes, PassCreator",
    );
    expect(external.find((c) => c.id === "address_lookup")?.label).toBe(
      "Address lookup, Nominatim",
    );
    expect(external.find((c) => c.id === "map_tiles")?.label).toBe("Map tiles, OpenStreetMap");
    expect(external.find((c) => c.id === "weather")?.label).toBe("Weather, Open-Meteo");
    expect(external.find((c) => c.id === "weather")?.status).toBe("planned");
    expect(external.find((c) => c.id === "identity_providers")?.label).toBe("Identity provider");
    expect(external.find((c) => c.id === "identity_providers")?.status).toBe("not_configured");
    expect(external.find((c) => c.id === "cloudflare_access")?.label).toBe("Cloudflare Access");
    expect(external.find((c) => c.id === "cloudflare_access")?.status).toBe("not_configured");
    expect(external.find((c) => c.id === "email_sending")?.summary).toBe("Connected");
  });

  it("emits one Identity provider row per configured IDP", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    checkMailer.mockReturnValue({ configured: false, provider: null });
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: null, source: "default", locked: false },
    });
    listOidcProviders.mockResolvedValue([
      {
        id: "idp-1",
        provider_type: "oidc",
        display_name: "Authentik",
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/auth",
        token_endpoint: "https://auth.example.com/token",
        jwks_uri: "https://auth.example.com/jwks",
        enabled: true,
      },
      {
        id: "idp-2",
        provider_type: "oidc",
        display_name: "Okta",
        issuer: "https://okta.example.com",
        authorization_endpoint: "https://okta.example.com/auth",
        token_endpoint: "https://okta.example.com/token",
        jwks_uri: "https://okta.example.com/jwks",
        enabled: false,
      },
    ]);
    findEnabledOidcProviders.mockResolvedValue([
      { id: "idp-1", provider_type: "oidc", display_name: "Authentik" },
    ]);
    getCfAccessConfig.mockResolvedValue({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      jwksUri: "",
    });

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const external = report.groups[1]!.checks;
    expect(external.find((c) => c.id === "identity_providers")).toBeUndefined();
    expect(external.find((c) => c.id === "identity_provider_idp-1")?.label).toBe(
      "Identity provider, OIDC - Authentik",
    );
    expect(external.find((c) => c.id === "identity_provider_idp-2")?.label).toBe(
      "Identity provider, OIDC - Okta",
    );
    expect(external.find((c) => c.id === "identity_provider_idp-2")?.summary).toBe(
      "Configured · disabled",
    );
  });

  it("marks mail queue degraded above threshold", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: MAIL_QUEUE_DEGRADED_THRESHOLD,
      email_deliveries_failed_retryable: 0,
    });
    checkMailer.mockReturnValue({ configured: false, provider: null });
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: null, source: "default", locked: false },
    });
    listOidcProviders.mockResolvedValue([]);
    findEnabledOidcProviders.mockResolvedValue([]);
    getCfAccessConfig.mockResolvedValue({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      jwksUri: "",
    });

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const queue = report.groups[0]!.checks.find((c) => c.id === "mail_delivery_queue");
    expect(queue?.status).toBe("degraded");
    expect(report.overall).toBe("degraded");
  });

  it("runs Nominatim live probe when live=true", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    checkMailer.mockReturnValue({ configured: false, provider: null });
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: null, source: "default", locked: false },
    });
    listOidcProviders.mockResolvedValue([]);
    findEnabledOidcProviders.mockResolvedValue([]);
    getCfAccessConfig.mockResolvedValue({
      enabled: false,
      teamDomain: "",
      audience: [],
      protectedPrefixes: [],
      jwksUri: "",
    });
    isLocationMapsEnabled.mockReturnValue(true);

    const search = vi.fn().mockResolvedValue([{ label: "Warsaw" }]);
    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      geocodingProvider: { name: "nominatim", search, reverse: vi.fn() },
    });

    expect(search).toHaveBeenCalledWith("Warsaw");
    const address = report.groups[1]!.checks.find((c) => c.id === "address_lookup");
    expect(address?.summary).toBe("Reachable");
    expect(address?.details.some((d) => d.key === "live_check" && d.value === "ok")).toBe(true);
  });
});
