import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nominatimCtor = vi.fn();

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

import { createApp } from "../src/app.js";

describe("createApp", () => {
  beforeEach(() => {
    nominatimCtor.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
});
