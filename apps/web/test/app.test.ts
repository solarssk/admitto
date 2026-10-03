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

  describe("body size caps on routes that parse the body before authenticating the caller", () => {
    const oversized = "x".repeat(70 * 1024);
    const makeApp = () =>
      createApp({
        checkinToken: null,
        allowCheckinBearer: false,
        baseUrl: "https://tickets.example.com",
        skipCheckinBootValidation: true,
      });

    it.each([
      ["/api/auth/login", "application/json", JSON.stringify({ email: "a@example.com", password: oversized })],
      ["/api/auth/mfa/verify", "application/json", JSON.stringify({ code: oversized })],
      ["/login", "application/x-www-form-urlencoded", `email=a%40example.com&password=${oversized}`],
      ["/setup", "application/x-www-form-urlencoded", `email=a%40example.com&password=${oversized}`],
      ["/mfa/verify", "application/x-www-form-urlencoded", `code=${oversized}`],
    ])("rejects an oversized POST %s with 413 before it is parsed", async (path, contentType, body) => {
      const res = await makeApp().request(path, {
        method: "POST",
        headers: { "Content-Type": contentType, Origin: "http://localhost" },
        body,
      });
      expect(res.status).toBe(413);
    });

    it("counts oversized webhook requests against the rate limit instead of refusing them for free", async () => {
      const app = makeApp();
      const send = () =>
        app.request("/api/wallet/webhook/passcreator/evt-rate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signedData: oversized }),
        });
      for (let i = 0; i < 120; i++) expect((await send()).status).toBe(413);
      expect((await send()).status).toBe(429);
    });

    it("counts oversized login requests against the login rate limit", async () => {
      const app = makeApp();
      const send = () =>
        app.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({ email: "a@example.com", password: oversized }),
        });
      for (let i = 0; i < 10; i++) expect((await send()).status).toBe(413);
      expect((await send()).status).toBe(429);
    });

    it.each([
      "/api/wallet/webhook/passcreator/evt-1",
      "/api/wallet/webhook/passcreator/evt-1/voided",
      "/api/wallet/webhook/passcreator/evt-1/first-confirmed",
    ])("rejects an oversized wallet webhook POST %s with 413 before it is parsed", async (path) => {
      const res = await makeApp().request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedData: oversized }),
      });
      expect(res.status).toBe(413);
    });
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
    const options = nominatimCtor.mock.calls[0]?.[0] as {
      buildUserAgent: () => Promise<string>;
      baseUrl: string | (() => string);
      timeoutMs: number | (() => number);
    };
    await expect(options.buildUserAgent()).resolves.toEqual(expect.any(String));
    // createApp passes live resolvers so UI maps settings can change base URL / timeout.
    const baseUrl = typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl;
    const timeoutMs =
      typeof options.timeoutMs === "function" ? options.timeoutMs() : options.timeoutMs;
    expect(baseUrl).toContain("nominatim");
    expect(timeoutMs).toBeGreaterThan(0);
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
