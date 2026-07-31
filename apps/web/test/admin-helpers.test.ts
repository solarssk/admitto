import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  countAttendeesByEvent,
  isValidCalendarDate,
  resolveActorEmailForLog,
  resolveClientTimezone,
} from "../src/admin/admin-helpers.js";

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

describe("isValidCalendarDate", () => {
  it("rejects a string with the wrong number of dash-separated parts", () => {
    // parseDateBound's own regex (\d{4}-\d{2}-\d{2}) already guarantees exactly 3 parts before
    // ever calling this - exercised here directly since it's exported and a caller with a
    // looser gate could still reach this branch.
    expect(isValidCalendarDate("2026-02")).toBe(false);
    expect(isValidCalendarDate("2026-02-30-99")).toBe(false);
  });

  it("rejects an impossible day-for-month", () => {
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
  });

  it("accepts a real calendar date", () => {
    expect(isValidCalendarDate("2026-02-28")).toBe(true);
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

describe("countAttendeesByEvent", () => {
  function dbReturning(rows: Array<{ event_id: string; _count: { _all: number } }>) {
    return { attendee: { groupBy: vi.fn().mockResolvedValue(rows) } } as unknown as PrismaClient;
  }

  it("maps each event id to its grouped attendee count", async () => {
    const db = dbReturning([
      { event_id: "evt-1", _count: { _all: 3 } },
      { event_id: "evt-2", _count: { _all: 0 } },
    ]);
    const result = await countAttendeesByEvent(db, ["evt-1", "evt-2"]);
    expect(result.get("evt-1")).toBe(3);
    expect(result.get("evt-2")).toBe(0);
  });

  it("has no entry for an event id groupBy didn't return a row for", async () => {
    const db = dbReturning([]);
    const result = await countAttendeesByEvent(db, ["evt-empty"]);
    expect(result.has("evt-empty")).toBe(false);
  });
});
