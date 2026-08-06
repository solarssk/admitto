import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";

const {
  canManageInstance,
  describeWeatherSettings,
  patchWeatherSettings,
  describeMapsSettings,
  patchMapsSettings,
  describeWalletSettings,
  patchWalletSettings,
  refreshMapsConfigCache,
  writeAdminAuditLog,
  adminAuditFromContext,
} = vi.hoisted(() => ({
  canManageInstance: vi.fn(async () => true),
  describeWeatherSettings: vi.fn(),
  patchWeatherSettings: vi.fn(),
  describeMapsSettings: vi.fn(),
  patchMapsSettings: vi.fn(),
  describeWalletSettings: vi.fn(),
  patchWalletSettings: vi.fn(),
  refreshMapsConfigCache: vi.fn(async () => undefined),
  writeAdminAuditLog: vi.fn(async () => undefined),
  adminAuditFromContext: vi.fn(() => ({
    operator: "user-1",
    sessionId: "sess-1",
    ip: "127.0.0.1",
    timezone: "UTC",
  })),
}));

vi.mock("@admitto/auth", () => ({
  canManageInstance,
}));

vi.mock("@admitto/tickets", () => ({
  writeAdminAuditLog,
}));

vi.mock("../../src/admin/admin-helpers.js", () => ({
  adminAuditFromContext,
}));

vi.mock("@admitto/shared/ssrf-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/shared/ssrf-guard")>();
  return {
    ...actual,
    resolveSafeHostname: vi.fn(async (hostname: string) => {
      const host = actual.unbracketHostname(hostname);
      if (actual.isLoopbackHost(host) || actual.isBlockedPrivateOrMetadataHost(host)) {
        throw new actual.SafeHostnameError(
          "hostname_blocked",
          "hostname must not resolve to a private or link-local address",
        );
      }
      return [{ address: "203.0.113.10", family: 4 as const }];
    }),
  };
});

vi.mock("../../src/weather/weather-org-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/weather/weather-org-settings.js")>();
  return {
    ...actual,
    describeWeatherSettings,
    patchWeatherSettings,
  };
});

vi.mock("../../src/maps/maps-org-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/maps/maps-org-settings.js")>();
  return {
    ...actual,
    describeMapsSettings,
    patchMapsSettings,
    refreshMapsConfigCache,
  };
});

vi.mock("../../src/wallet/wallet-org-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/wallet/wallet-org-settings.js")>();
  return {
    ...actual,
    describeWalletSettings,
    patchWalletSettings,
  };
});

import {
  handleGetExternalServices,
  handlePutMapsSettings,
  handlePutWeatherSettings,
  handlePutWalletSettings,
} from "../../src/admin/external-services-routes.js";

function mockContext(body?: unknown): Context {
  return {
    get: () => ({ userId: "user-1" }),
    req: {
      json: async () => {
        if (body === undefined) throw new SyntaxError("bad json");
        return body;
      },
    },
    json: (payload: unknown, status?: number) =>
      Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

const db = {} as PrismaClient;

const weatherPublic = {
  enabled: true,
  provider: "metno" as const,
  baseUrl: "https://api.open-meteo.com",
  apiKey: { configured: false, source: "none" as const },
  attribution: "Weather data by MET Norway",
  attributionUrl: "https://www.met.no/en",
  commercialNotice: "notice",
  horizonDays: 9,
  contactConfigured: true,
};

const mapsPublic = {
  enabled: true,
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OSM",
  maxZoom: 19,
  geocodingProvider: "nominatim",
  geocodingBaseUrl: "https://nominatim.openstreetmap.org",
};

const walletPublic = {
  apiKey: { configured: false, source: "none" as const },
};

describe("external-services GET/PUT routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageInstance.mockResolvedValue(true);
    describeWeatherSettings.mockResolvedValue(weatherPublic);
    describeMapsSettings.mockResolvedValue(mapsPublic);
    describeWalletSettings.mockResolvedValue(walletPublic);
    patchWeatherSettings.mockResolvedValue(weatherPublic);
    patchMapsSettings.mockResolvedValue(mapsPublic);
    patchWalletSettings.mockResolvedValue(walletPublic);
  });

  it("forbids GET for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handleGetExternalServices(mockContext({}), db);
    expect(res.status).toBe(403);
  });

  it("returns serialized weather + maps + wallet on GET", async () => {
    const res = await handleGetExternalServices(mockContext({}), db);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      weather: { provider: string; api_key: { configured: boolean } };
      maps: { max_zoom: number };
      wallet: { api_key: { configured: boolean } };
    };
    expect(body.weather.provider).toBe("metno");
    expect(body.weather.api_key.configured).toBe(false);
    expect(body.maps.max_zoom).toBe(19);
    expect(body.wallet.api_key.configured).toBe(false);
    expect(refreshMapsConfigCache).toHaveBeenCalled();
  });

  it("rejects invalid JSON on weather PUT", async () => {
    const res = await handlePutWeatherSettings(mockContext(undefined), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("rejects invalid weather base URL", async () => {
    const res = await handlePutWeatherSettings(
      mockContext({ provider: "openmeteo", baseUrl: "not-a-url" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_base_url" });
  });

  it("rejects private weather base URL hosts", async () => {
    const res = await handlePutWeatherSettings(
      mockContext({ provider: "openmeteo", baseUrl: "http://10.0.0.5/v1" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "url_host_blocked" });
    expect(patchWeatherSettings).not.toHaveBeenCalled();
  });

  it("rejects unresolved weather base URL hosts", async () => {
    const { resolveSafeHostname, SafeHostnameError } = await import("@admitto/shared/ssrf-guard");
    vi.mocked(resolveSafeHostname).mockRejectedValueOnce(
      new SafeHostnameError("hostname_unresolved", "hostname could not be resolved"),
    );
    const res = await handlePutWeatherSettings(
      mockContext({ provider: "openmeteo", baseUrl: "https://missing.example" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "url_host_unresolved" });
    expect(patchWeatherSettings).not.toHaveBeenCalled();
  });

  it("requires API key for commercial Open-Meteo when enabling", async () => {
    const res = await handlePutWeatherSettings(
      mockContext({
        enabled: true,
        provider: "openmeteo",
        baseUrl: "https://customer-api.open-meteo.com",
      }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "api_key_required" });
    expect(patchWeatherSettings).not.toHaveBeenCalled();
  });

  it("clears blank weather baseUrl to the built-in default for key checks", async () => {
    describeWeatherSettings.mockResolvedValue({
      ...weatherPublic,
      provider: "openmeteo",
      baseUrl: "https://customer-api.open-meteo.com",
      apiKey: { configured: false, source: "none" },
    });
    patchWeatherSettings.mockResolvedValue({
      ...weatherPublic,
      provider: "openmeteo",
      baseUrl: "https://api.open-meteo.com",
    });
    const res = await handlePutWeatherSettings(
      mockContext({ provider: "openmeteo", baseUrl: "" }),
      db,
    );
    expect(res.status).toBe(200);
    expect(patchWeatherSettings).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ baseUrl: "" }),
    );
  });

  it("persists weather settings and writes an audit log", async () => {
    const res = await handlePutWeatherSettings(
      mockContext({ enabled: false, provider: "metno" }),
      db,
    );
    expect(res.status).toBe(200);
    expect(patchWeatherSettings).toHaveBeenCalled();
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ actionType: "weather_settings_updated" }),
    );
  });

  it("rejects incompatible maps tile URLs", async () => {
    const res = await handlePutMapsSettings(
      mockContext({ tileUrl: "http://tiles.internal.example/{z}/{x}/{y}.png" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_tile_url" });
  });

  it("rejects invalid geocoding base URLs", async () => {
    const res = await handlePutMapsSettings(
      mockContext({ geocodingBaseUrl: "ftp://bad.example" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_geocoding_base_url" });
  });

  it("rejects private geocoding base URL hosts", async () => {
    const res = await handlePutMapsSettings(
      mockContext({ geocodingBaseUrl: "http://169.254.169.254/" }),
      db,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "url_host_blocked" });
    expect(patchMapsSettings).not.toHaveBeenCalled();
  });

  it("persists maps settings and writes an audit log", async () => {
    const res = await handlePutMapsSettings(
      mockContext({ enabled: false, maxZoom: 12 }),
      db,
    );
    expect(res.status).toBe(200);
    expect(patchMapsSettings).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ enabled: false, maxZoom: 12 }),
    );
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ actionType: "maps_settings_updated" }),
    );
  });

  it("forbids weather PUT for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePutWeatherSettings(mockContext({ enabled: false }), db);
    expect(res.status).toBe(403);
  });

  it("rejects weather PUT validation_failed", async () => {
    const res = await handlePutWeatherSettings(mockContext({ provider: "smtp" }), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_failed" });
  });

  it("forbids maps PUT for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePutMapsSettings(mockContext({ enabled: false }), db);
    expect(res.status).toBe(403);
  });

  it("rejects maps PUT invalid_json and validation_failed", async () => {
    expect((await handlePutMapsSettings(mockContext(undefined), db)).status).toBe(400);
    const res = await handlePutMapsSettings(mockContext({ maxZoom: 99 }), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_failed" });
  });

  it("accepts weather PUT clearing apiKey when weather is disabled", async () => {
    describeWeatherSettings.mockResolvedValue({
      ...weatherPublic,
      enabled: false,
      provider: "openmeteo",
      baseUrl: "https://customer-api.open-meteo.com",
      apiKey: { configured: true, source: "organization" },
    });
    patchWeatherSettings.mockResolvedValue({
      ...weatherPublic,
      enabled: false,
      provider: "openmeteo",
      apiKey: { configured: false, source: "none" },
    });
    const res = await handlePutWeatherSettings(
      mockContext({ enabled: false, provider: "openmeteo", apiKey: "" }),
      db,
    );
    expect(res.status).toBe(200);
    expect(patchWeatherSettings).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ apiKey: "" }),
    );
  });

  it("forbids wallet PUT for non-superadmins", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePutWalletSettings(mockContext({ apiKey: "secret" }), db);
    expect(res.status).toBe(403);
    expect(patchWalletSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON on wallet PUT", async () => {
    const res = await handlePutWalletSettings(mockContext(undefined), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("rejects wallet PUT validation_failed", async () => {
    const res = await handlePutWalletSettings(mockContext({ apiKey: 12345 }), db);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_failed" });
    expect(patchWalletSettings).not.toHaveBeenCalled();
  });

  it("persists wallet settings and writes an audit log", async () => {
    patchWalletSettings.mockResolvedValue({
      apiKey: { configured: true, source: "organization" },
    });
    const res = await handlePutWalletSettings(mockContext({ apiKey: "secret-key" }), db);
    expect(res.status).toBe(200);
    expect(patchWalletSettings).toHaveBeenCalledWith(db, { apiKey: "secret-key" });
    expect(writeAdminAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        actionType: "wallet_settings_updated",
        metadata: { api_key_configured: true },
      }),
    );
    const body = (await res.json()) as { wallet: { api_key: { configured: boolean } } };
    expect(body.wallet.api_key.configured).toBe(true);
  });

  it("accepts wallet PUT clearing apiKey with null", async () => {
    patchWalletSettings.mockResolvedValue({
      apiKey: { configured: false, source: "none" },
    });
    const res = await handlePutWalletSettings(mockContext({ apiKey: null }), db);
    expect(res.status).toBe(200);
    expect(patchWalletSettings).toHaveBeenCalledWith(db, { apiKey: null });
  });
});
