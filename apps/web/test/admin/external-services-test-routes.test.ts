import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";

const {
  canManageInstance,
  resolveEffectiveWeatherConfig,
  isGeocodingContactConfigured,
  buildGeocodingUserAgent,
  weatherProbeLive,
  nominatimSearch,
} = vi.hoisted(() => ({
  canManageInstance: vi.fn(async () => true),
  resolveEffectiveWeatherConfig: vi.fn(),
  isGeocodingContactConfigured: vi.fn(async () => true),
  buildGeocodingUserAgent: vi.fn(async () => "Admitto/test (test@example.com)"),
  weatherProbeLive: vi.fn(),
  nominatimSearch: vi.fn(),
}));

vi.mock("@admitto/auth", () => ({
  canManageInstance,
}));

vi.mock("../../src/weather/weather-org-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/weather/weather-org-settings.js")>();
  return {
    ...actual,
    resolveEffectiveWeatherConfig,
  };
});

vi.mock("../../src/maps/user-agent.js", () => ({
  isGeocodingContactConfigured,
  buildGeocodingUserAgent,
}));

vi.mock("../../src/weather/weather-service.js", () => ({
  WeatherService: class {
    probeLive = weatherProbeLive;
  },
}));

vi.mock("../../src/maps/nominatim-provider.js", () => ({
  NominatimProvider: class {
    search = nominatimSearch;
  },
}));

import {
  handlePostWeatherTest,
  handlePostMapsTest,
} from "../../src/admin/external-services-routes.js";

function mockContext(body: unknown): Context {
  return {
    get: () => ({ userId: "user-1" }),
    req: {
      json: async () => body,
    },
    json: (payload: unknown, status?: number) =>
      Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

const db = {} as PrismaClient;

describe("external-services connection tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageInstance.mockResolvedValue(true);
    isGeocodingContactConfigured.mockResolvedValue(true);
    buildGeocodingUserAgent.mockResolvedValue("Admitto/test (test@example.com)");
    resolveEffectiveWeatherConfig.mockResolvedValue({
      enabled: true,
      provider: "metno",
      baseUrl: "https://api.open-meteo.com",
      apiKey: null,
      timeoutMs: 5000,
      cacheTtlMs: 1000,
    });
    weatherProbeLive.mockResolvedValue({ ok: true, latencyMs: 42 });
    nominatimSearch.mockResolvedValue([]);
  });

  it("probes weather from draft and returns latency", async () => {
    const res = await handlePostWeatherTest(
      mockContext({ provider: "metno" }),
      db,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message?: string; latency_ms?: number };
    expect(json.ok).toBe(true);
    expect(json.message).toContain("42 ms");
    expect(weatherProbeLive).toHaveBeenCalled();
  });

  it("returns support-contact error when MET Norway probe reports it", async () => {
    weatherProbeLive.mockResolvedValueOnce({
      ok: false,
      latencyMs: 1,
      error: "support_contact_required",
    });
    const res = await handlePostWeatherTest(
      mockContext({ provider: "metno" }),
      db,
    );
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Support contact/i);
  });

  it("probes Nominatim from draft geocoding URL", async () => {
    const res = await handlePostMapsTest(
      mockContext({ geocodingBaseUrl: "https://nominatim.openstreetmap.org" }),
      db,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message?: string };
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/Nominatim/i);
    expect(nominatimSearch).toHaveBeenCalledWith("Warsaw");
  });

  it("rejects maps test without Support contact", async () => {
    isGeocodingContactConfigured.mockResolvedValueOnce(false);
    const res = await handlePostMapsTest(
      mockContext({ geocodingBaseUrl: "https://nominatim.openstreetmap.org" }),
      db,
    );
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Support contact/i);
    expect(nominatimSearch).not.toHaveBeenCalled();
  });

  it("forbids weather test without instance manage access", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePostWeatherTest(
      mockContext({ provider: "openmeteo" }),
      db,
    );
    expect(res.status).toBe(403);
  });
});
