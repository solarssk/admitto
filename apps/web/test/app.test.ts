import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nominatimCtor = vi.fn();
const refreshMapsConfigCacheMock = vi.hoisted(() =>
  vi.fn(async () => ({
    tiles: {
      enabled: true,
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxZoom: 19,
      attribution: "© OSM",
    },
    geocoding: {
      provider: "nominatim",
      baseUrl: "https://nominatim.openstreetmap.org",
      timeoutMs: 5000,
    },
  })),
);

vi.mock("../src/maps/nominatim-provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/maps/nominatim-provider.js")>();
  return {
    ...actual,
    NominatimProvider: vi.fn().mockImplementation(function MockNominatim(
      this: unknown,
      options: { buildUserAgent: () => Promise<string> },
    ) {
      nominatimCtor(options);
      return {
        name: "nominatim",
        search: vi.fn(),
        reverse: vi.fn(),
      };
    }),
  };
});

vi.mock("../src/maps/maps-org-settings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/maps/maps-org-settings.js")>();
  return {
    ...actual,
    refreshMapsConfigCache: refreshMapsConfigCacheMock,
  };
});

import { createApp } from "../src/app.js";
import { getMapsConfigCache, setMapsConfigCache } from "../src/maps/config.js";

describe("createApp", () => {
  beforeEach(() => {
    nominatimCtor.mockClear();
    refreshMapsConfigCacheMock.mockReset();
    refreshMapsConfigCacheMock.mockResolvedValue({
      tiles: {
        enabled: true,
        tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        maxZoom: 19,
        attribution: "© OSM",
      },
      geocoding: {
        provider: "nominatim",
        baseUrl: "https://nominatim.openstreetmap.org",
        timeoutMs: 5000,
      },
    });
    setMapsConfigCache(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setMapsConfigCache(null);
  });

  it("mounts check-in routes without token; unauthenticated requests get 401", async () => {
    const app = createApp({
      checkinToken: null,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });
    const res = await app.request("/api/checkin/history?eventId=evt-1");
    expect(res.status).toBe(401);
  });

  it("rejects Bearer when ALLOW_CHECKIN_BEARER is false", async () => {
    const app = createApp({
      checkinToken: "secret-token",
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });
    const res = await app.request("/api/checkin/history?eventId=evt-1", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(401);
  });

  it("uses the disabled Bearer default when no option is injected", async () => {
    vi.stubEnv("ALLOW_CHECKIN_BEARER", "false");
    const app = createApp({
      checkinToken: "secret-token",
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });

    const res = await app.request("/api/checkin/history?eventId=evt-1", {
      headers: { Authorization: "Bearer secret-token" },
    });

    expect(res.status).toBe(401);
  });

  it("wires the default Nominatim provider User-Agent builder when none is injected", async () => {
    createApp({
      checkinToken: null,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });

    expect(nominatimCtor).toHaveBeenCalled();
    const options = nominatimCtor.mock.calls[0]?.[0] as { buildUserAgent: () => Promise<string> };
    await expect(options.buildUserAgent()).resolves.toEqual(expect.any(String));
  });

  it("falls back to built-in maps config when cache refresh fails", async () => {
    refreshMapsConfigCacheMock.mockRejectedValueOnce(new Error("redis/db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createApp({
      checkinToken: null,
      allowCheckinBearer: false,
      baseUrl: "https://tickets.example.com",
      skipCheckinBootValidation: true,
    });
    await vi.waitFor(() => {
      expect(errSpy).toHaveBeenCalled();
      expect(getMapsConfigCache()?.tiles.tileUrl).toContain("openstreetmap.org");
    });
    errSpy.mockRestore();
  });
});
