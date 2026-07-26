import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@prisma/client";
import { resolveActorEmailForLog, resolveClientTimezone } from "../src/admin/admin-helpers.js";

function appWithRequest(headers: Record<string, string> = {}) {
  const app = new Hono();
  app.get("/tz", (c) => c.json({ timezone: resolveClientTimezone(c) }));
  return app.request("/tz", { headers });
}

describe("resolveClientTimezone (Codecov review — previously untested)", () => {
  it("returns null when the header is missing", async () => {
    const res = await appWithRequest();
    expect(await res.json()).toEqual({ timezone: null });
  });

  it("returns null for a value that isn't a real IANA timezone", async () => {
    const res = await appWithRequest({ "X-Client-Timezone": "not/a-real-zone" });
    expect(await res.json()).toEqual({ timezone: null });
  });

  it("returns the header value when it's a valid IANA timezone", async () => {
    const res = await appWithRequest({ "X-Client-Timezone": "Europe/Warsaw" });
    expect(await res.json()).toEqual({ timezone: "Europe/Warsaw" });
  });
});

describe("resolveActorEmailForLog", () => {
  function dbReturning(user: { email: string } | null) {
    return { user: { findUnique: vi.fn().mockResolvedValue(user) } } as unknown as PrismaClient;
  }

  it("returns the user's full email", async () => {
    const email = await resolveActorEmailForLog(dbReturning({ email: "alice@example.com" }), "user-1");
    expect(email).toBe("alice@example.com");
  });

  it("returns null when the user row is gone", async () => {
    const email = await resolveActorEmailForLog(dbReturning(null), "user-1");
    expect(email).toBeNull();
  });

  it("returns null instead of throwing when the DB lookup itself fails", async () => {
    const db = { user: { findUnique: vi.fn().mockRejectedValue(new Error("connection lost")) } } as unknown as PrismaClient;
    await expect(resolveActorEmailForLog(db, "user-1")).resolves.toBeNull();
  });
});
