import { describe, expect, it, vi } from "vitest";
import {
  findDeliveriesForBounceBatch,
  findDeliveryForBounce,
  selectBounceDeliveryIndex,
  truncateEmailForLog,
} from "../../src/bounceIngest/correlate.js";

describe("findDeliveriesForBounceBatch", () => {
  it("loads all non-terminal rows per recipient newest-first in one findMany", async () => {
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
    expect(map.get("a@example.com")?.map((r) => r.id)).toEqual(["newer_a", "older_a"]);
    expect(map.get("b@example.com")?.map((r) => r.id)).toEqual(["b1"]);
    expect(map.size).toBe(2);
  });

  it("skips rows with a null recipient_email", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "null_email", recipient_email: null, queued_at: new Date("2026-08-02") },
      { id: "ok", recipient_email: "ok@example.com", queued_at: new Date("2026-08-01") },
    ]);
    const db = { emailDelivery: { findMany } } as never;

    const map = await findDeliveriesForBounceBatch(db, {
      eventId: "evt_1",
      recipientEmails: ["ok@example.com"],
    });

    expect(map.size).toBe(1);
    expect(map.get("ok@example.com")?.map((r) => r.id)).toEqual(["ok"]);
  });

  it("skips rows whose recipient_email normalizes to empty", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "blank", recipient_email: "   ", queued_at: new Date("2026-08-02") },
      { id: "ok", recipient_email: "ok@example.com", queued_at: new Date("2026-08-01") },
    ]);
    const db = { emailDelivery: { findMany } } as never;

    const map = await findDeliveriesForBounceBatch(db, {
      eventId: "evt_1",
      recipientEmails: ["ok@example.com"],
    });

    expect(map.get("ok@example.com")?.map((r) => r.id)).toEqual(["ok"]);
    expect(map.size).toBe(1);
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

  it("returns null when the batch lookup finds no rows", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { emailDelivery: { findMany } } as never;
    expect(
      await findDeliveryForBounce(db, { eventId: "evt_1", recipientEmail: "missing@example.com" }),
    ).toBeNull();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe("truncateEmailForLog", () => {
  it("redacts the local part so unmatched bounce recipients are not fully logged", () => {
    const out = truncateEmailForLog("nobody@example.com");
    expect(out).toBe("n***@example.com");
    expect(out).not.toContain("nobody");
  });
});

describe("selectBounceDeliveryIndex", () => {
  const smtp = { id: "smtp", provider_message_id: "<Abc@mail.example.com>" };
  const opaque = { id: "graph", provider_message_id: "3f2c-request-id" };
  const none = { id: "none", provider_message_id: null };
  const q = (...rows: object[]) => rows as never[];

  it("accepts an SMTP delivery only when the DSN names its Message-ID (case-insensitive)", () => {
    expect(selectBounceDeliveryIndex(q(smtp), ["<abc@mail.example.com>"])).toBe(0);
    expect(selectBounceDeliveryIndex(q(smtp), ["<other@mail.example.com>"])).toBe(-1);
    expect(selectBounceDeliveryIndex(q(smtp), [])).toBe(-1);
    expect(selectBounceDeliveryIndex(q(smtp), undefined)).toBe(-1);
  });

  it("keeps recipient-only matching for deliveries without an RFC Message-ID", () => {
    expect(selectBounceDeliveryIndex(q(opaque), [])).toBe(0);
    expect(selectBounceDeliveryIndex(q(none), undefined)).toBe(0);
  });

  it("skips a non-matching SMTP row and selects the next eligible one", () => {
    expect(selectBounceDeliveryIndex(q(smtp, none), [])).toBe(1);
  });
});
