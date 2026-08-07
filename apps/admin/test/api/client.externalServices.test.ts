// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchExternalServices,
  saveMapsSettings,
  saveWalletSettings,
  saveWeatherSettings,
  testMapsConnection,
  testWeatherConnection,
} from "../../src/api/client.js";

describe("external-services client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchExternalServices GETs the combined endpoint", async () => {
    const body = {
      weather: { enabled: true, provider: "metno" },
      maps: { enabled: true, max_zoom: 19 },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchExternalServices()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/external-services",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("saveWeatherSettings PUTs and returns the weather slice", async () => {
    const weather = { enabled: false, provider: "metno" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ weather }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveWeatherSettings({ enabled: false })).resolves.toEqual(weather);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/external-services/weather");
    expect(init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
  });

  it("saveMapsSettings PUTs and returns the maps slice", async () => {
    const maps = { enabled: true, max_zoom: 12 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ maps }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveMapsSettings({ maxZoom: 12 })).resolves.toEqual(maps);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/external-services/maps");
  });

  it("saveWalletSettings PUTs and returns the wallet slice", async () => {
    const wallet = { api_key: { configured: true, source: "organization" as const } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ wallet }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveWalletSettings({ apiKey: "pc-new-key" })).resolves.toEqual(wallet);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/external-services/wallet");
    expect(init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ apiKey: "pc-new-key" }),
    });
  });

  it("testWeatherConnection POSTs the draft probe body", async () => {
    const result = { ok: true, message: "Connected." };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(testWeatherConnection({ provider: "metno" })).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/external-services/weather/test");
  });

  it("testMapsConnection POSTs the geocoding base URL", async () => {
    const result = { ok: true, message: "Connected." };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      testMapsConnection({ geocodingBaseUrl: "https://nominatim.example.com" }),
    ).resolves.toEqual(result);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/external-services/maps/test");
  });

  it("throws ApiError when saveWeatherSettings is rejected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "api_key_required" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveWeatherSettings({
        provider: "openmeteo",
        baseUrl: "https://customer-api.open-meteo.com",
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
