import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";

const {
  canManageInstance,
  resolveEffectiveWeatherConfig,
  isGeocodingContactConfigured,
  buildGeocodingUserAgent,
  weatherProbeLive,
  weatherServiceCtor,
  nominatimSearch,
} = vi.hoisted(() => ({
  canManageInstance: vi.fn(async () => true),
  resolveEffectiveWeatherConfig: vi.fn(),
  isGeocodingContactConfigured: vi.fn(async () => true),
  buildGeocodingUserAgent: vi.fn(async () => "Admitto/test (test@example.com)"),
  weatherProbeLive: vi.fn(),
  weatherServiceCtor: vi.fn(),
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
    constructor(options: unknown) {
      weatherServiceCtor(options);
    }
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
      apiKey: "stored-key",
      timeoutMs: 5000,
      cacheTtlMs: 1000,
    });
    weatherProbeLive.mockResolvedValue({ ok: true, latencyMs: 42 });
    nominatimSearch.mockResolvedValue([]);
  });

  it("probes weather from draft and returns latency", async () => {
    const res = await handlePostWeatherTest(
      mockContext({
        provider: "openmeteo",
        baseUrl: "https://self.example.com",
      }),
      db,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message?: string; latency_ms?: number };
    expect(json.ok).toBe(true);
    expect(json.message).toContain("42 ms");
    expect(weatherProbeLive).toHaveBeenCalled();
    expect(weatherServiceCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          provider: "openmeteo",
          baseUrl: "https://self.example.com",
          apiKey: "stored-key",
        }),
      }),
    );
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

  it("rejects openmeteo customer host draft without an API key", async () => {
    resolveEffectiveWeatherConfig.mockResolvedValue({
      enabled: true,
      provider: "openmeteo",
      baseUrl: "https://customer-api.open-meteo.com",
      apiKey: null,
      timeoutMs: 5000,
      cacheTtlMs: 1000,
    });
    const res = await handlePostWeatherTest(
      mockContext({
        provider: "openmeteo",
        baseUrl: "https://customer-api.open-meteo.com",
        clearApiKey: true,
      }),
      db,
    );
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/API key/i);
    expect(weatherProbeLive).not.toHaveBeenCalled();
  });

  it("rejects invalid weather base URL", async () => {
    const res = await handlePostWeatherTest(
      mockContext({
        provider: "openmeteo",
        baseUrl: "not-a-url",
      }),
      db,
    );
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe("invalid_base_url");
    expect(weatherProbeLive).not.toHaveBeenCalled();
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

  it("returns maps probe failure with latency when Nominatim search rejects", async () => {
    nominatimSearch.mockRejectedValueOnce(new Error("upstream down"));
    const res = await handlePostMapsTest(
      mockContext({ geocodingBaseUrl: "https://nominatim.openstreetmap.org" }),
      db,
    );
    const json = (await res.json()) as { ok: boolean; error?: string; latency_ms?: number };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Could not reach Nominatim/i);
    expect(typeof json.latency_ms).toBe("number");
  });

  it("forbids weather test without instance manage access", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePostWeatherTest(
      mockContext({ provider: "openmeteo" }),
      db,
    );
    expect(res.status).toBe(403);
  });

  it("forbids maps test without instance manage access", async () => {
    canManageInstance.mockResolvedValueOnce(false);
    const res = await handlePostMapsTest(
      mockContext({ geocodingBaseUrl: "https://nominatim.openstreetmap.org" }),
      db,
    );
    expect(res.status).toBe(403);
    expect(nominatimSearch).not.toHaveBeenCalled();
  });

  function mockContextMaybeThrow(body: unknown | "throw"): Context {
    return {
      get: () => ({ userId: "user-1" }),
      req: {
        json: async () => {
          if (body === "throw") throw new SyntaxError("bad");
          return body;
        },
      },
      json: (payload: unknown, status?: number) =>
        Response.json(payload, { status: status ?? 200 }),
    } as unknown as Context;
  }

  it("rejects weather and maps test invalid_json and validation_failed", async () => {
    expect((await handlePostWeatherTest(mockContextMaybeThrow("throw"), db)).status).toBe(400);
    expect(
      (await handlePostWeatherTest(mockContext({ provider: "nope" }), db)).status,
    ).toBe(400);
    expect((await handlePostMapsTest(mockContextMaybeThrow("throw"), db)).status).toBe(400);
    expect((await handlePostMapsTest(mockContext({}), db)).status).toBe(400);
  });

  it("rejects maps test with an invalid geocoding URL", async () => {
    const res = await handlePostMapsTest(mockContext({ geocodingBaseUrl: "ftp://bad" }), db);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/valid http/i);
  });

  it("returns generic weather probe failure when probeLive fails", async () => {
    weatherProbeLive.mockResolvedValueOnce({ ok: false, latencyMs: 12, error: "timeout" });
    const res = await handlePostWeatherTest(mockContext({ provider: "metno" }), db);
    const json = (await res.json()) as { ok: boolean; error?: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/Could not reach the weather provider/);
  });

  it("passes an explicit draft apiKey into WeatherService", async () => {
    weatherProbeLive.mockResolvedValueOnce({ ok: true, latencyMs: 5 });
    await handlePostWeatherTest(
      mockContext({
        provider: "openmeteo",
        baseUrl: "https://api.open-meteo.com",
        apiKey: "draft-key",
      }),
      db,
    );
    expect(weatherServiceCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ apiKey: "draft-key" }),
      }),
    );
  });
});
