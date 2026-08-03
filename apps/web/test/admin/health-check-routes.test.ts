import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";

const {
  collectSetupChecks,
  collectGauges,
  checkMailer,
  checkDatabase,
  describeMailConfigForOrg,
  resolveMailConfigForOrg,
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
  checkDatabase: vi.fn(async () => ({ status: "ok", latency_ms: 2 })),
  describeMailConfigForOrg: vi.fn(),
  resolveMailConfigForOrg: vi.fn(),
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
  return { ...actual, collectGauges, checkMailer, checkDatabase };
});
vi.mock("../../src/ops/product-version.js", () => ({ resolveProductVersion }));
vi.mock("../../src/admin/instance-org.js", () => ({ resolveInstanceOrganizationId }));
vi.mock("@admitto/mailer-config", () => ({
  describeMailConfigForOrg,
  resolveMailConfigForOrg,
}));
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

import { canManageInstance } from "@admitto/auth";
import type { Context } from "hono";
import {
  collectAdminHealth,
  handleGetAdminHealth,
  handlePostAdminHealthLive,
  MAIL_QUEUE_DEGRADED_THRESHOLD,
  resolveHealthCommit,
  safeEndpointDisplay,
  mapTilesServiceLabel,
  worstHealthStatus,
} from "../../src/admin/health-check-routes.js";

const okSetup = {
  database: { ok: true, detail: "PostgreSQL connected · migrations current" },
  redis: { ok: true, detail: "Redis OK (2 ms)" },
  encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
  base_url: { ok: true, detail: "https://tickets.example.com" },
};

function stubHappyPathMailAndIdp() {
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
}

function fakeHealthContext(): Context {
  return {
    get: (key: string) => (key === "auth" ? { userId: "user-1" } : undefined),
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

afterEach(() => {
  vi.clearAllMocks();
  checkDatabase.mockResolvedValue({ status: "ok", latency_ms: 2 });
  resolveProductVersion.mockReturnValue("0.4.13");
  isLocationMapsEnabled.mockReturnValue(true);
  vi.mocked(canManageInstance).mockResolvedValue(true);
});

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

  it("returns undefined for an unparseable URL", () => {
    expect(safeEndpointDisplay("not a url at all")).toBeUndefined();
  });
});

describe("mapTilesServiceLabel", () => {
  it("labels known hosts and falls back when the URL cannot be displayed", () => {
    expect(mapTilesServiceLabel("https://tile.openstreetmap.org/{z}/{x}/{y}.png")).toBe(
      "Map tiles, OpenStreetMap",
    );
    expect(mapTilesServiceLabel("https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png")).toBe(
      "Map tiles, CARTO",
    );
    expect(mapTilesServiceLabel("https://tiles.example.com/{z}/{x}/{y}.png")).toBe(
      "Map tiles, tiles.example.com",
    );
    expect(mapTilesServiceLabel("not a url")).toBe("Map tiles");
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
    expect(core.find((c) => c.id === "rate_limit_storage")?.label).toBe("Rate-limit storage");
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
    expect(external.find((c) => c.id === "email_sending")?.summary).toBe("Configured");
    expect(
      core
        .find((c) => c.id === "database")
        ?.details.some((d) => d.key === "last_checked" && d.value === report.generated_at),
    ).toBe(true);
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

  it("keeps slow setup latency when parallel DB probe is faster", async () => {
    collectSetupChecks.mockResolvedValue({
      ...okSetup,
      database: {
        ok: true,
        warn: true,
        detail: "PostgreSQL connected · slow (1200 ms)",
      },
    });
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    checkDatabase.mockResolvedValue({ status: "ok", latency_ms: 5 });
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
      db: { $queryRaw: vi.fn().mockResolvedValue([{ version: "PostgreSQL 16.0" }]) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const database = report.groups[0]!.checks.find((c) => c.id === "database");
    expect(database?.status).toBe("degraded");
    expect(database?.summary).toBe("Responding slowly · 1200 ms");
    expect(database?.details.some((d) => d.key === "latency_ms" && d.value === "1200")).toBe(true);
  });

  it("marks mail queue degraded above threshold", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: MAIL_QUEUE_DEGRADED_THRESHOLD,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const queue = report.groups[0]!.checks.find((c) => c.id === "mail_delivery_queue");
    expect(queue?.status).toBe("degraded");
    expect(report.overall).toBe("degraded");
  });

  it("marks mail queue degraded when retryable failures exist alongside queued mail", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 12,
      email_deliveries_failed_retryable: 2,
    });
    stubHappyPathMailAndIdp();

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const queue = report.groups[0]!.checks.find((c) => c.id === "mail_delivery_queue");
    expect(queue?.status).toBe("degraded");
    expect(queue?.summary).toMatch(/Needs attention · 12 queued · 2 retryable/);
    expect(report.overall).toBe("degraded");
  });

  it("reports optional encryption in development as not_configured", async () => {
    collectSetupChecks.mockResolvedValue({
      ...okSetup,
      encryption: {
        ok: true,
        detail: "Optional in development (set ENCRYPTION_KEY for production parity)",
      },
    });
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const encryption = report.groups[0]!.checks.find((c) => c.id === "data_encryption");
    expect(encryption?.status).toBe("not_configured");
    expect(encryption?.summary).toBe("Optional in development");
    expect(report.overall).toBe("ok");
  });

  it("keeps returning a report when individual collectors reject", async () => {
    collectSetupChecks.mockRejectedValueOnce(new Error("setup boom"));
    collectGauges.mockRejectedValueOnce(new Error("gauges boom"));
    listOidcProviders.mockRejectedValueOnce(new Error("idp boom"));
    getCfAccessConfig.mockRejectedValueOnce(new Error("cf boom"));
    checkMailer.mockReturnValue({ configured: false, provider: null });
    resolveInstanceOrganizationId.mockRejectedValueOnce(new Error("org boom"));
    describeMailConfigForOrg.mockRejectedValueOnce(new Error("mail boom"));
    isLocationMapsEnabled.mockImplementationOnce(() => {
      throw new Error("maps boom");
    });

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    expect(report.groups).toHaveLength(2);
    expect(report.groups[0]!.checks.find((c) => c.id === "database")?.status).toBe("down");
    expect(report.groups[1]!.checks.find((c) => c.id === "email_sending")?.status).toBe("degraded");
    expect(report.groups[1]!.checks.find((c) => c.id === "identity_providers")?.status).toBe(
      "degraded",
    );
    expect(report.groups[1]!.checks.find((c) => c.id === "cloudflare_access")?.status).toBe(
      "degraded",
    );
    expect(report.groups[1]!.checks.find((c) => c.id === "address_lookup")?.status).toBe(
      "degraded",
    );
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

  it("marks address lookup down when the live Nominatim probe fails", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    isLocationMapsEnabled.mockReturnValue(true);

    const search = vi.fn().mockRejectedValue(new Error("timeout"));
    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      geocodingProvider: { name: "nominatim", search, reverse: vi.fn() },
    });

    const address = report.groups[1]!.checks.find((c) => c.id === "address_lookup");
    expect(address?.status).toBe("down");
    expect(address?.summary).toBe("Unreachable");
  });

  it("marks address lookup degraded when the live probe is slow", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    isLocationMapsEnabled.mockReturnValue(true);

    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const current = now;
      now += 2_000;
      return current;
    });

    const search = vi.fn().mockResolvedValue([{ label: "Warsaw" }]);
    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      geocodingProvider: { name: "nominatim", search, reverse: vi.fn() },
    });

    const address = report.groups[1]!.checks.find((c) => c.id === "address_lookup");
    expect(address?.status).toBe("degraded");
    expect(address?.summary).toMatch(/Slow to respond/);
    vi.restoreAllMocks();
  });

  it("marks address lookup not_configured when maps are disabled", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    isLocationMapsEnabled.mockReturnValue(false);

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const address = report.groups[1]!.checks.find((c) => c.id === "address_lookup");
    expect(address?.status).toBe("not_configured");
    expect(address?.summary).toBe("Maps disabled");
  });

  it("covers core failure and warn branches for database, redis, encryption, and instance URL", async () => {
    collectSetupChecks.mockResolvedValue({
      database: { ok: false, reason: "unreachable", detail: "PostgreSQL unreachable" },
      redis: { ok: false, detail: "Redis unreachable" },
      encryption: { ok: false, detail: "ENCRYPTION_KEY missing" },
      base_url: { ok: false, detail: "BASE_URL missing" },
    });
    collectGauges.mockResolvedValue({
      email_deliveries_queued: -1,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const core = report.groups[0]!.checks;
    expect(core.find((c) => c.id === "database")?.status).toBe("down");
    expect(core.find((c) => c.id === "database")?.summary).toBe("Not reachable");
    expect(core.find((c) => c.id === "rate_limit_storage")?.status).toBe("down");
    expect(core.find((c) => c.id === "data_encryption")?.status).toBe("down");
    expect(core.find((c) => c.id === "instance_url")?.status).toBe("down");
    expect(core.find((c) => c.id === "mail_delivery_queue")?.summary).toBe(
      "Could not read queue depth",
    );
    expect(report.overall).toBe("down");
  });

  it("covers migrations_pending, redis warn/in-memory, instance URL warn, and queue retryables", async () => {
    collectSetupChecks.mockResolvedValue({
      database: {
        ok: false,
        reason: "migrations_pending",
        detail: "PostgreSQL connected · migrations pending",
      },
      redis: { ok: true, warn: true, detail: "Redis OK (in-memory) (900 ms)" },
      encryption: { ok: true, detail: "ENCRYPTION_KEY configured (32 bytes)" },
      base_url: { ok: true, warn: true, detail: "optional in development" },
    });
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 3,
    });
    stubHappyPathMailAndIdp();

    const report = await collectAdminHealth({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ version: "PostgreSQL 16.2 on x86_64" }]),
      } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });

    const core = report.groups[0]!.checks;
    expect(core.find((c) => c.id === "database")?.summary).toBe("Schema update pending");
    expect(core.find((c) => c.id === "database")?.details.some((d) => d.key === "engine")).toBe(
      true,
    );
    expect(core.find((c) => c.id === "rate_limit_storage")?.status).toBe("degraded");
    expect(core.find((c) => c.id === "rate_limit_storage")?.summary).toMatch(/900 ms/);
    expect(core.find((c) => c.id === "instance_url")?.status).toBe("degraded");
    expect(core.find((c) => c.id === "mail_delivery_queue")?.status).toBe("degraded");
    expect(core.find((c) => c.id === "mail_delivery_queue")?.summary).toMatch(
      /Queue empty · 3 retryable/,
    );
  });

  it("labels mail providers and export_only / env fallback paths", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 3,
      email_deliveries_failed_retryable: 0,
    });
    checkMailer.mockReturnValue({ configured: true, provider: "graph" });
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "export_only", source: "organization", locked: false },
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

    const exportReport = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(exportReport.groups[1]!.checks.find((c) => c.id === "email_sending")?.label).toBe(
      "Email sending, Export only",
    );
    expect(exportReport.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe(
      "Export only · not sending",
    );
    expect(exportReport.groups[0]!.checks.find((c) => c.id === "mail_delivery_queue")?.summary).toBe(
      "Running · 3 queued",
    );

    describeMailConfigForOrg.mockRejectedValueOnce(new Error("org missing"));
    checkMailer.mockReturnValue({ configured: true, provider: "smtp" });
    const envFallback = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(envFallback.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe(
      "Configured",
    );
    expect(
      envFallback.groups[1]!.checks
        .find((c) => c.id === "email_sending")
        ?.details.some((d) => d.key === "source" && d.value === "env"),
    ).toBe(true);

    // Live: org/config resolution failure must stay degraded (no env greenwash).
    describeMailConfigForOrg.mockRejectedValueOnce(new Error("org missing"));
    checkMailer.mockReturnValue({ configured: true, provider: "smtp" });
    const liveLookupFail = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
    });
    expect(liveLookupFail.groups[1]!.checks.find((c) => c.id === "email_sending")?.status).toBe(
      "degraded",
    );
    expect(liveLookupFail.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe(
      "Could not read mail settings",
    );

    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "smtp", source: "organization", locked: false },
    });
    resolveMailConfigForOrg.mockRejectedValueOnce(new Error("allowed_from_domain conflict"));
    const probeMail = vi.fn();
    const liveResolveFail = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      probeMail,
    });
    expect(probeMail).not.toHaveBeenCalled();
    expect(liveResolveFail.groups[1]!.checks.find((c) => c.id === "email_sending")?.status).toBe(
      "degraded",
    );

    describeMailConfigForOrg.mockResolvedValueOnce({
      provider: { value: "powerautomate", source: "organization", locked: false },
    });
    const pa = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(pa.groups[1]!.checks.find((c) => c.id === "email_sending")?.label).toBe(
      "Email sending, Power Automate",
    );
  });

  it("runs live IdP and Cloudflare Access probes", async () => {
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
    ]);
    findEnabledOidcProviders.mockResolvedValue([
      { id: "idp-1", provider_type: "oidc", display_name: "Authentik" },
    ]);
    testOidcConnection.mockResolvedValueOnce({ ok: false, error: "jwks" });
    getCfAccessConfig.mockResolvedValue({
      enabled: true,
      teamDomain: "https://team.cloudflareaccess.com",
      audience: ["aud-1"],
      protectedPrefixes: ["/admin"],
      jwksUri: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
    });
    testCfAccessConnection.mockResolvedValueOnce({ ok: false, error: "jwks" });

    const downReport = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
    });
    expect(
      downReport.groups[1]!.checks.find((c) => c.id === "identity_provider_idp-1")?.status,
    ).toBe("down");
    expect(downReport.groups[1]!.checks.find((c) => c.id === "cloudflare_access")?.status).toBe(
      "down",
    );

    testOidcConnection.mockResolvedValueOnce({ ok: true });
    testCfAccessConnection.mockResolvedValueOnce({ ok: true });
    const okReport = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
    });
    expect(okReport.groups[1]!.checks.find((c) => c.id === "identity_provider_idp-1")?.summary).toBe(
      "Reachable",
    );
    expect(okReport.groups[1]!.checks.find((c) => c.id === "cloudflare_access")?.summary).toBe(
      "Reachable",
    );
  });

  it("runs live mail probe for SMTP/Graph and skips Power Automate", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
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
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    checkMailer.mockReturnValue({ configured: true, provider: "smtp" });
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "smtp", source: "organization", locked: false },
    });
    resolveMailConfigForOrg.mockResolvedValue({
      provider: "smtp",
      host: "smtp.example.com",
      port: 587,
      fromAddress: "from@example.com",
    });
    const probeMail = vi.fn().mockResolvedValue({ ok: true });

    const reachable = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      probeMail,
    });
    expect(probeMail).toHaveBeenCalled();
    expect(reachable.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe(
      "Reachable",
    );

    probeMail.mockResolvedValueOnce({ ok: false, error: "auth failed" });
    const down = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      probeMail,
    });
    expect(down.groups[1]!.checks.find((c) => c.id === "email_sending")?.status).toBe("down");
    expect(down.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe(
      "Unreachable",
    );

    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "powerautomate", source: "organization", locked: false },
    });
    const pa = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      probeMail,
    });
    expect(pa.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe("Configured");
    expect(
      pa.groups[1]!.checks
        .find((c) => c.id === "email_sending")
        ?.details.some((d) => d.key === "live_check" && d.value === "skipped"),
    ).toBe(true);

    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "smtp", source: "organization", locked: false },
    });
    probeMail.mockResolvedValueOnce({ ok: true, skipped: true });
    const skippedProbe = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      probeMail,
    });
    expect(skippedProbe.groups[1]!.checks.find((c) => c.id === "email_sending")?.summary).toBe(
      "Configured",
    );
    expect(
      skippedProbe.groups[1]!.checks
        .find((c) => c.id === "email_sending")
        ?.details.some((d) => d.key === "live_check" && d.value === "skipped"),
    ).toBe(true);
  });

  it("covers Graph label, unknown provider, redis/db slow without latency, encryption optional, IdP protocols", async () => {
    collectSetupChecks.mockResolvedValue({
      database: { ok: true, warn: true, detail: "PostgreSQL connected · slow" },
      redis: { ok: true, warn: true, detail: "Redis OK · elevated latency" },
      encryption: { ok: true, detail: "Optional in development" },
      base_url: { ok: true, detail: "https://tickets.example.com" },
    });
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    // NaN is not finite → resolveDatabaseLatencyMs ignores probe latency.
    checkDatabase.mockResolvedValue({ status: "ok", latency_ms: Number.NaN });
    checkMailer.mockReturnValue({ configured: true, provider: "graph" });
    resolveInstanceOrganizationId.mockResolvedValue("org-1");
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "graph", source: "organization", locked: false },
    });
    listOidcProviders.mockResolvedValue([
      {
        id: "saml-1",
        provider_type: "saml",
        display_name: "Okta SAML",
        issuer: "https://okta.example.com",
        authorization_endpoint: "https://okta.example.com/auth",
        token_endpoint: "https://okta.example.com/token",
        jwks_uri: "https://okta.example.com/jwks",
        enabled: false,
      },
      {
        id: "custom-1",
        provider_type: "custom_sso",
        display_name: "Custom",
        issuer: "https://sso.example.com",
        authorization_endpoint: "https://sso.example.com/auth",
        token_endpoint: "https://sso.example.com/token",
        jwks_uri: "https://sso.example.com/jwks",
        enabled: false,
      },
    ]);
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
    const core = report.groups[0]!.checks;
    expect(core.find((c) => c.id === "database")?.summary).toBe("Responding slowly");
    expect(core.find((c) => c.id === "rate_limit_storage")?.summary).toBe("Responding slowly");
    expect(core.find((c) => c.id === "data_encryption")?.status).toBe("not_configured");
    expect(report.groups[1]!.checks.find((c) => c.id === "email_sending")?.label).toBe(
      "Email sending, Microsoft Graph",
    );
    expect(report.groups[1]!.checks.find((c) => c.id === "identity_provider_saml-1")?.label).toBe(
      "Identity provider, SAML - Okta SAML",
    );
    expect(report.groups[1]!.checks.find((c) => c.id === "identity_provider_custom-1")?.label).toBe(
      "Identity provider, CUSTOM SSO - Custom",
    );

    // Healthy DB: fall back to latency parsed from setup detail when probe omits latency_ms.
    collectSetupChecks.mockResolvedValue({
      ...okSetup,
      database: { ok: true, detail: "PostgreSQL connected (7 ms)" },
    });
    listOidcProviders.mockResolvedValue([]);
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: null, source: "default", locked: false },
    });
    checkDatabase.mockResolvedValue({ status: "ok", latency_ms: Number.NaN });
    const latencyFromSetup = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(
      latencyFromSetup.groups[0]!.checks
        .find((c) => c.id === "database")
        ?.details.some((d) => d.key === "latency_ms" && d.value === "7"),
    ).toBe(true);

    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: "sendgrid", source: "organization", locked: false },
    });
    const unknown = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(unknown.groups[1]!.checks.find((c) => c.id === "email_sending")?.label).toBe(
      "Email sending",
    );
    expect(unknown.groups[1]!.checks.find((c) => c.id === "email_sending")?.status).toBe(
      "not_configured",
    );

    checkDatabase.mockRejectedValueOnce(new Error("probe boom"));
    collectSetupChecks.mockResolvedValue(okSetup);
    listOidcProviders.mockResolvedValue([]);
    describeMailConfigForOrg.mockResolvedValue({
      provider: { value: null, source: "default", locked: false },
    });
    const dbProbeFail = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(dbProbeFail.groups[0]!.checks.find((c) => c.id === "database")?.status).toBe("ok");
  });

  it("covers Cloudflare Access configured-disabled and passive enabled rows", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    getCfAccessConfig.mockResolvedValue({
      enabled: false,
      teamDomain: "https://team.cloudflareaccess.com",
      audience: [],
      protectedPrefixes: [],
      jwksUri: "",
    });

    const disabled = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(disabled.groups[1]!.checks.find((c) => c.id === "cloudflare_access")?.summary).toBe(
      "Configured · disabled",
    );

    getCfAccessConfig.mockResolvedValue({
      enabled: true,
      teamDomain: "https://team.cloudflareaccess.com",
      audience: ["a", "b"],
      protectedPrefixes: ["/"],
      jwksUri: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
    });
    const enabled = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: false,
    });
    expect(enabled.groups[1]!.checks.find((c) => c.id === "cloudflare_access")?.summary).toBe(
      "Configured · enabled",
    );
  });

  it("labels map tiles for CARTO and custom hosts, and not_configured when maps disabled", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    isLocationMapsEnabled.mockReturnValue(true);

    const carto = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: {
        MAP_TILE_URL: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      },
    });
    expect(carto.groups[1]!.checks.find((c) => c.id === "map_tiles")?.label).toBe(
      "Map tiles, CARTO",
    );

    const custom = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: { MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png" },
    });
    expect(custom.groups[1]!.checks.find((c) => c.id === "map_tiles")?.label).toBe(
      "Map tiles, tiles.example.com",
    );

    isLocationMapsEnabled.mockReturnValue(false);
    const disabled = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    expect(disabled.groups[1]!.checks.find((c) => c.id === "map_tiles")?.status).toBe(
      "not_configured",
    );
  });

  it("covers in-memory redis ok and IdP userinfo live probe", async () => {
    collectSetupChecks.mockResolvedValue({
      ...okSetup,
      redis: { ok: true, detail: "Redis OK (in-memory) (2 ms)" },
      base_url: { ok: true, detail: "tickets.example.com" },
    });
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    listOidcProviders.mockResolvedValue([
      {
        id: "idp-2",
        provider_type: "oidc",
        display_name: "With Userinfo",
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/auth",
        token_endpoint: "https://auth.example.com/token",
        jwks_uri: "https://auth.example.com/jwks",
        userinfo_endpoint: "https://auth.example.com/userinfo",
        enabled: true,
      },
    ]);
    findEnabledOidcProviders.mockResolvedValue([
      { id: "idp-2", provider_type: "oidc", display_name: "With Userinfo" },
    ]);
    testOidcConnection.mockResolvedValue({ ok: true });

    const report = await collectAdminHealth({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ version: "AcmeDB 12.0.1 for testing engines" }]),
      } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
      env: {
        MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png",
        MAP_TILE_ATTRIBUTION: "© Example Tiles",
      },
    });
    expect(report.groups[0]!.checks.find((c) => c.id === "rate_limit_storage")?.summary).toBe(
      "Connected (in-memory)",
    );
    expect(
      report.groups[0]!.checks
        .find((c) => c.id === "instance_url")
        ?.details.some((d) => d.key === "url"),
    ).toBe(false);
    expect(
      report.groups[0]!.checks
        .find((c) => c.id === "database")
        ?.details.some((d) => d.key === "engine" && d.value?.startsWith("AcmeDB")),
    ).toBe(true);
    expect(
      report.groups[1]!.checks
        .find((c) => c.id === "map_tiles")
        ?.details.some((d) => d.key === "attribution" && d.value === "set"),
    ).toBe(true);
    expect(testOidcConnection).toHaveBeenCalledWith(
      expect.objectContaining({ userinfo_endpoint: "https://auth.example.com/userinfo" }),
    );

    const emptyEngine = await collectAdminHealth({
      db: {
        $queryRaw: vi.fn().mockResolvedValue([{ version: "   " }]),
      } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: {
        MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png",
        MAP_TILE_ATTRIBUTION: "",
      },
    });
    expect(
      emptyEngine.groups[0]!.checks
        .find((c) => c.id === "database")
        ?.details.some((d) => d.key === "engine"),
    ).toBe(false);
    expect(
      emptyEngine.groups[1]!.checks
        .find((c) => c.id === "map_tiles")
        ?.details.some((d) => d.key === "attribution" && d.value === "set"),
    ).toBe(true);
  });
});

describe("handleGetAdminHealth / handlePostAdminHealthLive", () => {
  it("returns 403 when the caller cannot manage the instance", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(false);
    const res = await handleGetAdminHealth(fakeHealthContext(), {} as PrismaClient, {} as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  it("returns the passive report for GET and live report for POST", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    vi.mocked(canManageInstance).mockResolvedValue(true);

    const getRes = await handleGetAdminHealth(
      fakeHealthContext(),
      { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      {} as never,
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as { overall: string; groups: unknown[] };
    expect(getBody.groups).toHaveLength(2);

    const search = vi.fn().mockResolvedValue([{ label: "Warsaw" }]);
    isLocationMapsEnabled.mockReturnValue(true);
    const postRes = await handlePostAdminHealthLive(
      fakeHealthContext(),
      { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      {} as never,
      { geocodingProvider: { name: "nominatim", search, reverse: vi.fn() } },
    );
    expect(postRes.status).toBe(200);
    expect(search).toHaveBeenCalled();
  });

  it("returns 403 on live when the caller cannot manage the instance", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(false);
    const res = await handlePostAdminHealthLive(
      fakeHealthContext(),
      {} as PrismaClient,
      {} as never,
    );
    expect(res.status).toBe(403);
  });
});
