import { describe, expect, it, vi } from "vitest";
import {
  findDeliveriesForBounceBatch,
  findDeliveryForBounce,
  truncateEmailForLog,
} from "../../src/bounceIngest/correlate.js";

describe("findDeliveriesForBounceBatch", () => {
  it("loads newest non-terminal row per recipient in one findMany", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "newer_a", recipient_email: "a@example.com", queued_at: new Date("2026-08-02") },
      { id: "older_a", recipient_email: "a@example.com", queued_at: new Date("2026-08-01") },
      { id: "b1", recipient_email: "b@example.com", queued_at: new Date("2026-08-02") },
    ]);
    const db = { emailDelivery: { findMany } } as never;

    const map = await findDeliveriesForBounceBatch(db, {
      eventId: "evt_1",
      recipientEmails: ["A@Example.COM", "b@example.com", "a@example.com"],
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        event_id: "evt_1",
        recipient_email: { in: ["a@example.com", "b@example.com"] },
        status: { in: ["queued", "accepted", "sent"] },
      },
      orderBy: { queued_at: "desc" },
    });
    expect(map.get("a@example.com")?.id).toBe("newer_a");
    expect(map.get("b@example.com")?.id).toBe("b1");
    expect(map.size).toBe(2);
  });

  it("returns an empty map when there are no emails", async () => {
    const findMany = vi.fn();
    const db = { emailDelivery: { findMany } } as never;
    expect(
      await findDeliveriesForBounceBatch(db, { eventId: "evt_1", recipientEmails: ["  "] }),
    ).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("findDeliveryForBounce", () => {
  it("queries via the batch helper for a single recipient", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "newer", recipient_email: "user@example.com" }]);
    const db = { emailDelivery: { findMany } } as never;

    const row = await findDeliveryForBounce(db, {
      eventId: "evt_1",
      recipientEmail: "User@Example.COM",
    });

    expect(row).toEqual({ id: "newer", recipient_email: "user@example.com" });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        event_id: "evt_1",
        recipient_email: { in: ["user@example.com"] },
        status: { in: ["queued", "accepted", "sent"] },
      },
      orderBy: { queued_at: "desc" },
    });
  });

  it("returns null when email is empty", async () => {
    const findMany = vi.fn();
    const db = { emailDelivery: { findMany } } as never;
    expect(await findDeliveryForBounce(db, { eventId: "evt_1", recipientEmail: "  " })).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("truncateEmailForLog", () => {
  it("redacts the local part so unmatched bounce recipients are not fully logged", () => {
    const out = truncateEmailForLog("nobody@example.com");
    expect(out).toBe("n***@example.com");
    expect(out).not.toContain("nobody");
  });
});
