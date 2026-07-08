import { afterEach, describe, expect, it } from "vitest";
import {
  formatActivityTimestamp,
  getTimelineIcon,
  getTimelineLabel,
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

  it("treats an admin revoke as event-operational, same as undo (#449 review)", () => {
    expect(isEventOperationalActivity("check_in_revoked")).toBe(true);
  });
});

describe("check_in_revoked timeline mapping (#449 review)", () => {
  it("gets a ban icon and a capitalized label", () => {
    expect(getTimelineIcon("check_in_revoked")).toBe("ban");
    expect(
      getTimelineLabel({
        id: "log-1",
        action_type: "check_in_revoked",
        actor_display: "admin",
        metadata: null,
        created_at: "2026-06-28T13:00:00.000Z",
      }),
    ).toBe("Check-in revoked");
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

  it("uses event timezone for check_in_revoked, not UTC (#449 review)", () => {
    setPreferredLocale("en-GB");
    const result = formatActivityTimestamp(ISO, "check_in_revoked", "Europe/Warsaw");
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/CEST|GMT\+2/);
  });
});
