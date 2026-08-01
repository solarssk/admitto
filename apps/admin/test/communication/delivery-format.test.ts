import { describe, expect, it } from "vitest";
import { rowTimestamp } from "../../src/communication/delivery-format.js";

describe("rowTimestamp", () => {
  it("falls all the way back to queued_at when nothing later ever happened", () => {
    expect(
      rowTimestamp({
        sent_at: null,
        accepted_at: null,
        failed_at: null,
        queued_at: "2026-09-01T11:55:00.000Z",
      }),
    ).toBe("2026-09-01T11:55:00.000Z");
  });

  it("prefers sent_at over every earlier stage", () => {
    expect(
      rowTimestamp({
        sent_at: "2026-09-01T12:10:00.000Z",
        accepted_at: "2026-09-01T12:05:00.000Z",
        failed_at: null,
        queued_at: "2026-09-01T11:55:00.000Z",
      }),
    ).toBe("2026-09-01T12:10:00.000Z");
  });
});
