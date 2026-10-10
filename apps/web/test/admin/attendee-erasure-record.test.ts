import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { resolveIpLocation } from "../../src/rate-limit/ip-location.js";
import { loadAttendeeErasureRecord } from "../../src/admin/attendee-erasure-record.js";

const ERASED_AT = new Date("2026-10-08T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const INPUT = {
  organizationId: "org-1",
  eventId: "evt-1",
  attendeeId: "att-1",
  erasedAt: ERASED_AT,
  includeLocation: false,
};

const auditRow = (overrides: Record<string, unknown> = {}) => ({
  actor_display_name: "Admin Example",
  actor_email: "admin@example.com",
  actor_timezone: "Europe/Zurich",
  ip: "203.0.113.7",
  source: null,
  ...overrides,
});

/** The audit log answering with `rows`; `queryRaw` is what the lookup asked, as a tagged template (strings, then the values). */
function auditLogAnswering(rows: unknown[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return { db: { $queryRaw: queryRaw } as unknown as PrismaClient, queryRaw };
}

describe("loadAttendeeErasureRecord", () => {
  it("says who erased the person, through what and in which zone, and no address when the viewer may not know it", async () => {
    const { db } = auditLogAnswering([auditRow()]);

    const record = await loadAttendeeErasureRecord(db, INPUT);

    expect(record).toEqual({
      by: { display_name: "Admin Example", email: "admin@example.com" },
      via: "admin",
      timezone: "Europe/Zurich",
      ip: null,
      location: null,
    });
  });

  it("adds the address and where it is for a viewer who may read the audit log", async () => {
    const { db } = auditLogAnswering([auditRow()]);

    const record = await loadAttendeeErasureRecord(db, { ...INPUT, includeLocation: true });

    expect(record?.ip).toBe("203.0.113.7");
    expect(record?.location).toEqual(resolveIpLocation("203.0.113.7"));
  });

  it("knows an address of the private network for what it is", async () => {
    const { db } = auditLogAnswering([auditRow({ ip: "10.0.0.5" })]);

    const record = await loadAttendeeErasureRecord(db, { ...INPUT, includeLocation: true });

    expect(record).toMatchObject({ ip: "10.0.0.5", location: { kind: "internal" } });
  });

  it("names the command line, and gives no address for it: the one the log holds is a placeholder", async () => {
    const { db } = auditLogAnswering([auditRow({ source: "cli", ip: "127.0.0.1" })]);

    const record = await loadAttendeeErasureRecord(db, { ...INPUT, includeLocation: true });

    expect(record).toMatchObject({ via: "cli", ip: null, location: null });
  });

  it.each([["unknown"], ["not an address"], [""], [null]])("gives no address for %j: it is no place", async (ip) => {
    const { db } = auditLogAnswering([auditRow({ ip })]);

    const record = await loadAttendeeErasureRecord(db, { ...INPUT, includeLocation: true });

    expect(record).toMatchObject({ ip: null, location: null });
  });

  it("keeps an address of the IPv6 kind as it is", async () => {
    const { db } = auditLogAnswering([auditRow({ ip: "2001:db8::1" })]);

    const record = await loadAttendeeErasureRecord(db, { ...INPUT, includeLocation: true });

    expect(record?.ip).toBe("2001:db8::1");
  });

  it("names the staff member by the address alone when the log kept no name", async () => {
    const { db } = auditLogAnswering([auditRow({ actor_display_name: null })]);

    const record = await loadAttendeeErasureRecord(db, INPUT);

    expect(record?.by).toEqual({ display_name: null, email: "admin@example.com" });
  });

  it("names no one when the entry kept no identity", async () => {
    const { db } = auditLogAnswering([auditRow({ actor_display_name: null, actor_email: null })]);

    const record = await loadAttendeeErasureRecord(db, INPUT);

    expect(record).toMatchObject({ by: null, via: "admin" });
  });

  it("has no record when the audit log has no entry of the erasure", async () => {
    const { db } = auditLogAnswering([]);

    expect(await loadAttendeeErasureRecord(db, INPUT)).toBeNull();
  });

  it("asks for this organisation's log, around the time of the erasure, for this event and this attendee", async () => {
    const { db, queryRaw } = auditLogAnswering([]);

    await loadAttendeeErasureRecord(db, INPUT);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [, ...values] = queryRaw.mock.calls[0]!;
    // organisation, the hour before and after, event, and the attendee for a single erasure and for a bulk one.
    expect(values).toEqual([
      "org-1",
      new Date(ERASED_AT.getTime() - HOUR_MS),
      new Date(ERASED_AT.getTime() + HOUR_MS),
      "evt-1",
      "att-1",
      "att-1",
    ]);
  });
});
