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

  it("uses an admin field mapping instead of the default keys when provided", () => {
    const data = toPassCreatorData(
      { ...baseInput, eventHoursLabel: "18:00-22:00", eventLocationLabel: "Test Venue" },
      "tmpl-1",
      { attendeeFullName: "full_name", ticketKind: "ticket_type" },
    );
    expect(data).toMatchObject({
      templateId: "tmpl-1",
      userProvidedId: "admitto:evt-1:att-1",
      attendeeFullName: "Alice Admin",
      ticketKind: "VIP",
    });
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("eventDate");
  });

  it("drops a mapped field whose source value is unset", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", { hours: "event_hours" });
    expect(data).not.toHaveProperty("hours");
  });

  it("falls back to the default mapping when fieldMapping is empty", () => {
    const data = toPassCreatorData(baseInput, "tmpl-1", {});
    expect(data.name).toBe("Alice Admin");
  });
});
