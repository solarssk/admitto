import { describe, expect, it, vi } from "vitest";
import { findDeliveryForBounce } from "../../src/bounceIngest/correlate.js";

describe("findDeliveryForBounce", () => {
  it("queries newest non-terminal row for event + recipient", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "newer" });
    const db = { emailDelivery: { findFirst } } as never;

    const row = await findDeliveryForBounce(db, {
      eventId: "evt_1",
      recipientEmail: "User@Example.COM",
    });

    expect(row).toEqual({ id: "newer" });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        event_id: "evt_1",
        recipient_email: "user@example.com",
        status: { in: ["queued", "accepted", "sent"] },
      },
      orderBy: { queued_at: "desc" },
    });
  });

  it("returns null when email is empty", async () => {
    const findFirst = vi.fn();
    const db = { emailDelivery: { findFirst } } as never;
    expect(await findDeliveryForBounce(db, { eventId: "evt_1", recipientEmail: "  " })).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
