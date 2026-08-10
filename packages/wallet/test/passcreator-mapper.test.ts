import { describe, expect, it } from "vitest";
import { toPassCreatorData } from "../src/passcreator-mapper.js";
import type { WalletPassInput } from "../src/types.js";

const baseInput: WalletPassInput = {
  attendeeName: "Alice Admin",
  eventDateLabel: "2026-08-10",
  ticketTypeLabel: "VIP",
  userProvidedId: "admitto:evt-1:att-1",
};

describe("toPassCreatorData", () => {
  it("includes eventHours and eventPlace when both labels are provided", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
    );
    expect(data.eventHours).toBe("18:00-22:00");
    expect(data.eventPlace).toBe("Test Venue");
  });

  it("omits eventHours and eventPlace when both labels are absent", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1");
    expect(data).not.toHaveProperty("eventHours");
    expect(data).not.toHaveProperty("eventPlace");
  });
});
