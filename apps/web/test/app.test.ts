import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("createApp", () => {
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
});
