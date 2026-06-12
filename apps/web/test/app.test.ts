import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("createApp", () => {
  it("allows explicit null checkinToken to force disabled check-in gate", async () => {
    const app = createApp({
      checkinToken: null,
      baseUrl: "https://tickets.example.com",
    });
    const res = await app.request("/api/checkin/history?eventId=evt-1");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "check-in not configured" });
  });
});
