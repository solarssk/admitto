import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { activeAttendeeWhere, countActiveAdmittedAttendees, countActiveAttendees, countSeatsInUse } from "../src/event-seats.js";

function makeDb(total = 7) {
  const count = vi.fn().mockResolvedValue(total);
  return { db: { attendee: { count } } as unknown as PrismaClient, count };
}

describe("event seats", () => {
  it("scopes active attendees to the event and excludes revoked and cancelled", () => {
    expect(activeAttendeeWhere("evt-1")).toEqual({
      event_id: "evt-1",
      status: { notIn: ["revoked", "cancelled"] },
    });
  });

  it("counts heads over active attendees", async () => {
    const { db, count } = makeDb(5);
    await expect(countActiveAttendees(db, "evt-1")).resolves.toBe(5);
    expect(count).toHaveBeenCalledWith({ where: activeAttendeeWhere("evt-1") });
  });

  it("counts admitted heads with the same active scope", async () => {
    const { db, count } = makeDb(3);
    await expect(countActiveAdmittedAttendees(db, "evt-1")).resolves.toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: { ...activeAttendeeWhere("evt-1"), admitted_at: { not: null } },
    });
  });

  it("counts seats the same as heads while no companion exists", async () => {
    const { db, count } = makeDb(9);
    await expect(countSeatsInUse(db, "evt-1")).resolves.toBe(9);
    expect(count).toHaveBeenCalledWith({ where: activeAttendeeWhere("evt-1") });
  });
});
