import { afterEach, describe, expect, it } from "vitest";
import {
  formatActivityTimestamp,
  isEventOperationalActivity,
} from "../../src/attendees/attendeeTimeline.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

describe("isEventOperationalActivity", () => {
  it("treats check-in and item actions as event-operational", () => {
    expect(isEventOperationalActivity("admitted")).toBe(true);
    expect(isEventOperationalActivity("item_issued")).toBe(true);
  });

  it("treats mail and import actions as system rows", () => {
    expect(isEventOperationalActivity("ticket_sent")).toBe(false);
    expect(isEventOperationalActivity("attendee_imported")).toBe(false);
  });
});

describe("formatActivityTimestamp", () => {
  afterEach(() => setPreferredLocale(null));

  const ISO = "2026-06-28T13:00:00.000Z";

  it("uses event timezone for operational rows", () => {
    setPreferredLocale("en-GB");
    const result = formatActivityTimestamp(ISO, "admitted", "Europe/Warsaw");
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/CEST|GMT\+2/);
  });

  it("uses UTC for system rows", () => {
    setPreferredLocale("en-GB");
    const result = formatActivityTimestamp(ISO, "ticket_sent", "Europe/Warsaw");
    expect(result).toMatch(/13:00/);
    expect(result).toMatch(/UTC/);
  });
});
