import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@admitto/db";

const { writeFileMock, setRealWriteFile, restoreWriteFile } = vi.hoisted(() => {
  const writeFileMock = vi.fn();
  let realWriteFile: (...args: unknown[]) => Promise<unknown> = async () => {
    throw new Error("writeFile mock not initialized");
  };
  return {
    writeFileMock,
    setRealWriteFile(fn: (...args: unknown[]) => Promise<unknown>) {
      realWriteFile = fn;
      writeFileMock.mockImplementation((...args: unknown[]) => realWriteFile(...args));
    },
    restoreWriteFile() {
      writeFileMock.mockReset();
      writeFileMock.mockImplementation((...args: unknown[]) => realWriteFile(...args));
    },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  setRealWriteFile(actual.writeFile.bind(actual) as (...args: unknown[]) => Promise<unknown>);
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => writeFileMock(...args),
  };
});

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
  resolveEffectiveWeatherConfig,
  createWeatherServiceFromDb,
  isGeocodingContactConfigured,
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
  resolveEffectiveWeatherConfig: vi.fn(),
  createWeatherServiceFromDb: vi.fn(),
  isGeocodingContactConfigured: vi.fn(async () => true),
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
vi.mock("../../src/admin/admin-build-meta.js", () => ({
  readAdminBuildMeta: vi.fn(() => null),
  adminDistCandidates: vi.fn(() => []),
}));
vi.mock("../../src/admin/instance-org.js", () => ({ resolveInstanceOrganizationId }));
vi.mock("@admitto/mailer-config", () => ({
  describeMailConfigForOrg,
  resolveMailConfigForOrg,
}));
vi.mock("../../src/weather/weather-org-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/weather/weather-org-settings.js")>();
  return {
    ...actual,
    resolveEffectiveWeatherConfig,
    createWeatherServiceFromDb,
  };
});
vi.mock("../../src/maps/user-agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/maps/user-agent.js")>();
  return { ...actual, isGeocodingContactConfigured };
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
import { readAdminBuildMeta } from "../../src/admin/admin-build-meta.js";
import {
  collectAdminHealth,
  fileStorageRow,
  handleAdminHealth,
  MAIL_QUEUE_DEGRADED_THRESHOLD,
  resolveHealthCommit,
  resolveHealthVersion,
  safeEndpointDisplay,
  mapTilesServiceLabel,
  worstHealthStatus,
} from "../../src/admin/health-check-routes.js";
import {
  defaultGeocodingConfig,
  defaultMapTileConfig,
  setMapsConfigCache,
} from "../../src/maps/config.js";

const readAdminBuildMetaMock = vi.mocked(readAdminBuildMeta);

function setMapsEnabled(enabled: boolean) {
  setMapsConfigCache({
    tiles: { ...defaultMapTileConfig(), enabled },
    geocoding: defaultGeocodingConfig(),
  });
}

/** Writable upload root so File storage does not flip overall to down in CI (uploads/ is gitignored). */
const uploadFixture = { dir: "" };

function envWithUpload(partial: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { UPLOAD_DIR: uploadFixture.dir, ...partial };
}

beforeAll(async () => {
  uploadFixture.dir = await mkdtemp(join(tmpdir(), "admitto-health-upload-"));
  process.env.UPLOAD_DIR = uploadFixture.dir;
});

afterAll(async () => {
  delete process.env.UPLOAD_DIR;
  if (uploadFixture.dir) {
    await rm(uploadFixture.dir, { recursive: true, force: true });
  }
});

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
  resolveEffectiveWeatherConfig.mockResolvedValue({
    enabled: true,
    provider: "metno",
    baseUrl: "https://api.open-meteo.com",
    apiKey: null,
    timeoutMs: 5000,
    cacheTtlMs: 21600000,
  });
  isGeocodingContactConfigured.mockResolvedValue(true);
}

function fakeHealthContext(): Context {
  return {
    get: (key: string) => (key === "auth" ? { userId: "user-1" } : undefined),
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

afterEach(() => {
  vi.clearAllMocks();
  restoreWriteFile();
  checkDatabase.mockResolvedValue({ status: "ok", latency_ms: 2 });
  resolveProductVersion.mockReturnValue("0.4.13");
  readAdminBuildMetaMock.mockReturnValue(null);
  setMapsConfigCache(null);
  vi.mocked(canManageInstance).mockResolvedValue(true);
  resolveEffectiveWeatherConfig.mockResolvedValue({
    enabled: true,
    provider: "metno",
    baseUrl: "https://api.open-meteo.com",
    apiKey: null,
    timeoutMs: 5000,
    cacheTtlMs: 21600000,
  });
  isGeocodingContactConfigured.mockResolvedValue(true);
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

  it("falls back to git HEAD when GIT_COMMIT is unset", () => {
    const sha = resolveHealthCommit({});
    expect(sha).toMatch(/^[0-9a-f]{7}$/);
    expect(sha).not.toBe("unknown");
  });

  it("prefers the served admin SPA build-meta over GIT_COMMIT", () => {
    readAdminBuildMetaMock.mockReturnValue({ version: "0.4.12", commit: "a21c357" });
    expect(
      resolveHealthCommit({
        NODE_ENV: "development",
        GIT_COMMIT: "deadbeefdeadbeef",
      }),
    ).toBe("a21c357");
    expect(resolveHealthVersion()).toBe("0.4.12");
  });

  it("skips build-meta when its commit is unknown and uses GIT_COMMIT", () => {
    readAdminBuildMetaMock.mockReturnValue({ version: "0.4.12", commit: "unknown" });
    expect(resolveHealthCommit({ GIT_COMMIT: "abcdef0123456789" })).toBe("abcdef0");
  });

  it("uses GIT_COMMIT in development when no SPA build-meta is present", () => {
    expect(
      resolveHealthCommit({
        NODE_ENV: "development",
        GIT_COMMIT: "deadbeefdeadbeef",
      }),
    ).toBe("deadbee");
  });

  it("returns unknown when git HEAD cannot be resolved", () => {
    expect(
      resolveHealthCommit({}, { gitHead: () => {
        throw new Error("no git");
      } }),
    ).toBe("unknown");
    expect(resolveHealthCommit({}, { gitHead: () => "" })).toBe("unknown");
  });
});

describe("fileStorageRow", () => {
  const checkedAt = "2026-08-04T12:00:00.000Z";

  it("reports ok for a writable local upload dir", async () => {
    const row = await fileStorageRow({ UPLOAD_DIR: uploadFixture.dir }, checkedAt, false);
    expect(row.status).toBe("ok");
    expect(row.summary).toBe("Connected");
    expect(row.details.find((d) => d.key === "provider")?.value).toBe("local");
    expect(row.details.find((d) => d.key === "writable")?.value).toBe("yes");
  });

  it("runs a live write+unlink probe", async () => {
    const row = await fileStorageRow({ UPLOAD_DIR: uploadFixture.dir }, checkedAt, true);
    expect(row.status).toBe("ok");
  });

  it("reports degraded when the directory is missing (adapter creates it on first put)", async () => {
    const row = await fileStorageRow(
      { UPLOAD_DIR: join(uploadFixture.dir, "does-not-exist") },
      checkedAt,
      false,
    );
    expect(row.status).toBe("degraded");
    expect(row.summary).toBe("Missing directory · created on first upload");
    expect(row.details.find((d) => d.key === "reason")?.value).toBe("missing_directory");
  });

  it("reports down when UPLOAD_DIR is a regular file", async () => {
    const fileAsUploadRoot = join(uploadFixture.dir, "not-a-directory");
    await writeFile(fileAsUploadRoot, "x");
    const row = await fileStorageRow({ UPLOAD_DIR: fileAsUploadRoot }, checkedAt, false);
    expect(row.status).toBe("down");
    expect(row.summary).toBe("Not a directory");
    expect(row.details.find((d) => d.key === "reason")?.value).toBe("not_a_directory");
  });

  it("reports down when the directory is not writable", async () => {
    const locked = await mkdtemp(join(tmpdir(), "admitto-health-locked-"));
    try {
      await chmod(locked, 0o555);
      const row = await fileStorageRow({ UPLOAD_DIR: locked }, checkedAt, false);
      expect(row.status).toBe("down");
      expect(row.summary).toBe("Not writable");
      expect(row.details.find((d) => d.key === "reason")?.value).toBe("not_writable");
    } finally {
      await chmod(locked, 0o755);
      await rm(locked, { recursive: true, force: true });
    }
  });

  it("reports degraded for s3 and unknown providers", async () => {
    await expect(fileStorageRow({ STORAGE_PROVIDER: "s3" }, checkedAt, false)).resolves.toMatchObject(
      { status: "degraded", summary: "S3 not implemented" },
    );
    await expect(
      fileStorageRow({ STORAGE_PROVIDER: "azure", UPLOAD_DIR: uploadFixture.dir }, checkedAt, false),
    ).resolves.toMatchObject({ status: "degraded", summary: "Unknown provider (azure)" });
  });

  it("reports degraded when the live write probe fails", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("ENOSPC"));
    const row = await fileStorageRow({ UPLOAD_DIR: uploadFixture.dir }, checkedAt, true);
    expect(row.status).toBe("degraded");
    expect(row.summary).toBe("Write probe failed");
    expect(row.details.find((d) => d.key === "reason")?.value).toBe("write_probe_failed");
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
  it("builds core and external groups including weather", async () => {
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
      env: envWithUpload({ GIT_COMMIT: "deadbeef" }),
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
    expect(core.find((c) => c.id === "file_storage")?.status).toBe("ok");
    expect(core.find((c) => c.id === "file_storage")?.summary).toBe("Connected");

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
    expect(external.find((c) => c.id === "weather")?.label).toBe("Weather, MET Norway");
    expect(external.find((c) => c.id === "weather")?.status).toBe("ok");
    expect(external.find((c) => c.id === "weather")?.summary).toBe("Provider available");
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

  it("marks passive MET Norway weather degraded without Support contact", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    isGeocodingContactConfigured.mockResolvedValue(false);

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: envWithUpload({ GIT_COMMIT: "deadbeef" }),
      now: () => new Date("2026-08-03T12:00:00.000Z"),
    });

    const weather = report.groups[1]!.checks.find((c) => c.id === "weather");
    expect(weather?.status).toBe("degraded");
    expect(weather?.summary).toBe("Support contact required");
  });

  it("marks weather not_configured when disabled", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    resolveEffectiveWeatherConfig.mockResolvedValue({
      enabled: false,
      provider: "metno",
      baseUrl: "https://api.open-meteo.com",
      apiKey: null,
      timeoutMs: 5000,
      cacheTtlMs: 21600000,
    });

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    const weather = report.groups[1]!.checks.find((c) => c.id === "weather");
    expect(weather?.status).toBe("not_configured");
    expect(weather?.summary).toBe("Weather disabled");
  });

  it("labels Open-Meteo passively and includes api_key detail", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();
    resolveEffectiveWeatherConfig.mockResolvedValue({
      enabled: true,
      provider: "openmeteo",
      baseUrl: "https://api.open-meteo.com",
      apiKey: null,
      timeoutMs: 5000,
      cacheTtlMs: 21600000,
    });

    const report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
    });
    const weather = report.groups[1]!.checks.find((c) => c.id === "weather");
    expect(weather?.label).toBe("Weather, Open-Meteo");
    expect(weather?.details.some((d) => d.key === "api_key" && d.value === "none")).toBe(true);
  });

  it("live weather probe reports ok, degraded, and down", async () => {
    collectSetupChecks.mockResolvedValue(okSetup);
    collectGauges.mockResolvedValue({
      email_deliveries_queued: 0,
      email_deliveries_failed_retryable: 0,
    });
    stubHappyPathMailAndIdp();

    createWeatherServiceFromDb.mockResolvedValue({
      probeLive: vi.fn(async () => ({ ok: true, latencyMs: 10 })),
    });
    let report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
    });
    expect(report.groups[1]!.checks.find((c) => c.id === "weather")?.status).toBe("ok");

    createWeatherServiceFromDb.mockResolvedValue({
      probeLive: vi.fn(async () => ({ ok: true, latencyMs: 2_000 })),
    });
    report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
    });
    expect(report.groups[1]!.checks.find((c) => c.id === "weather")?.status).toBe("degraded");

    createWeatherServiceFromDb.mockResolvedValue({
      probeLive: vi.fn(async () => ({
        ok: false,
        latencyMs: 5,
        error: "support_contact_required",
      })),
    });
    report = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      live: true,
    });
    const weather = report.groups[1]!.checks.find((c) => c.id === "weather");
    expect(weather?.status).toBe("down");
    expect(weather?.summary).toBe("Support contact required");
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
    setMapsEnabled(true);

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
    setMapsEnabled(true);

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
    setMapsEnabled(true);

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
    setMapsEnabled(false);

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
    setMapsEnabled(true);

    const carto = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: envWithUpload({
        MAP_TILE_URL: "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      }),
    });
    expect(carto.groups[1]!.checks.find((c) => c.id === "map_tiles")?.label).toBe(
      "Map tiles, CARTO",
    );

    const custom = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      env: envWithUpload({ MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png" }),
    });
    expect(custom.groups[1]!.checks.find((c) => c.id === "map_tiles")?.label).toBe(
      "Map tiles, tiles.example.com",
    );

    setMapsEnabled(false);
    const disabled = await collectAdminHealth({
      db: { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      rateLimitStore: {} as never,
      // Explicit env bag so resolveMapTileConfig consults LOCATION_MAPS_* (not process defaults).
      env: envWithUpload({ LOCATION_MAPS_ENABLED: "false" }),
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
      env: envWithUpload({
        MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png",
        MAP_TILE_ATTRIBUTION: "© Example Tiles",
      }),
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
      env: envWithUpload({
        MAP_TILE_URL: "https://tiles.example.com/{z}/{x}/{y}.png",
        MAP_TILE_ATTRIBUTION: "",
      }),
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

describe("handleAdminHealth", () => {
  it("returns 403 when the caller cannot manage the instance", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(false);
    const res = await handleAdminHealth(fakeHealthContext(), {} as PrismaClient, {} as never);
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
    readAdminBuildMetaMock.mockImplementation((root) =>
      root === "/served-admin-dist" ? { version: "0.4.12", commit: "a21c357" } : null,
    );

    const getRes = await handleAdminHealth(
      fakeHealthContext(),
      { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      {} as never,
      { adminDistRoot: "/served-admin-dist" },
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      overall: string;
      groups: unknown[];
      version: string;
      commit: string;
    };
    expect(getBody.groups).toHaveLength(2);
    expect(getBody.version).toBe("0.4.12");
    expect(getBody.commit).toBe("a21c357");
    expect(readAdminBuildMetaMock).toHaveBeenCalledWith("/served-admin-dist");

    const search = vi.fn().mockResolvedValue([{ label: "Warsaw" }]);
    setMapsEnabled(true);
    const postRes = await handleAdminHealth(
      fakeHealthContext(),
      { $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as unknown as PrismaClient,
      {} as never,
      {
        geocodingProvider: { name: "nominatim", search, reverse: vi.fn() },
        adminDistRoot: "/served-admin-dist",
        live: true,
      },
    );
    expect(postRes.status).toBe(200);
    expect(search).toHaveBeenCalled();
    const postBody = (await postRes.json()) as { commit: string };
    expect(postBody.commit).toBe("a21c357");
  });

  it("returns 403 on live when the caller cannot manage the instance", async () => {
    vi.mocked(canManageInstance).mockResolvedValueOnce(false);
    const res = await handleAdminHealth(
      fakeHealthContext(),
      {} as PrismaClient,
      {} as never,
      { live: true },
    );
    expect(res.status).toBe(403);
  });
});
