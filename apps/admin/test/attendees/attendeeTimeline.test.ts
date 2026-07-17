import { afterEach, describe, expect, it } from "vitest";
import {
  formatActivityTimestamp,
  getTimelineDetail,
  getTimelineIcon,
  getTimelineLabel,
} from "../../src/attendees/attendeeTimeline.js";
import { setPreferredLocale } from "../../src/utils/locale-store.js";

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

describe("item_revoked timeline mapping (bot review, #457)", () => {
  it("gets an undo icon and a capitalized label, not the generic fallback", () => {
    expect(getTimelineIcon("item_revoked")).toBe("arrow-back-up");
    expect(
      getTimelineLabel({
        id: "log-1",
        action_type: "item_revoked",
        actor_display: "admin",
        metadata: null,
        created_at: "2026-06-28T13:00:00.000Z",
      }),
    ).toBe("Item reset to pending");
  });
});

describe("getTimelineDetail — pre-existing rsvp_status_changed rendering", () => {
  it("still shows the RSVP transition after the #364 refactor", () => {
    expect(
      getTimelineDetail({
        id: "log-1",
        action_type: "rsvp_status_changed",
        actor_display: "Admin",
        metadata: { from: "none", to: "confirmed" },
        created_at: "2026-06-28T13:00:00.000Z",
      }),
    ).toBe("Registered → Confirmed · Admin");
  });
});

describe("getTimelineDetail — profile/pass/item diffs (#364)", () => {
  function entry(overrides: Partial<Parameters<typeof getTimelineDetail>[0]>) {
    return {
      id: "log-1",
      action_type: "attendee_edited",
      actor_display: "operator 1",
      metadata: null,
      created_at: "2026-06-28T13:00:00.000Z",
      ...overrides,
    };
  }

  it("lists changed field names for attendee_edited, not raw values (PII-safe)", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "attendee_edited", metadata: { fields: ["email", "company"] } }),
      ),
    ).toBe("Email, Company · operator 1");
  });

  it("humanizes an unlabeled custom_data field key for attendee_edited", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "attendee_edited", metadata: { fields: ["shirt_size"] } }),
      ),
    ).toBe("Shirt size · operator 1");
  });

  it("falls back to the actor alone when attendee_edited has no fields metadata", () => {
    expect(getTimelineDetail(entry({ action_type: "attendee_edited", metadata: null }))).toBe(
      "operator 1",
    );
  });

  it("shows the pass status transition for pass_revoked", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "pass_revoked",
          metadata: { previous_status: "registered" },
        }),
      ),
    ).toBe("Active → Revoked · operator 1");
  });

  it("falls back to the raw status string for an unrecognized previous_status value", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "pass_revoked",
          metadata: { previous_status: "some_future_status" },
        }),
      ),
    ).toBe("some_future_status → Revoked · operator 1");
  });

  it("shows the pass status transition for pass_restored", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "pass_restored",
          metadata: { previous_status: "revoked" },
        }),
      ),
    ).toBe("Revoked → Active · operator 1");
  });

  it("shows the humanized event item key for item_issued/item_returned/item_revoked", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "item_issued", metadata: { event_item_key: "badge" } }),
      ),
    ).toBe("Badge · operator 1");
    expect(
      getTimelineDetail(
        entry({
          action_type: "item_returned",
          metadata: { event_item_key: "gift_bag", from_state: "issued", to_state: "returned" },
        }),
      ),
    ).toBe("Gift bag · operator 1");
    expect(
      getTimelineDetail(
        entry({
          action_type: "item_revoked",
          metadata: { event_item_key: "badge", from_state: "issued", to_state: "pending" },
        }),
      ),
    ).toBe("Badge · operator 1");
  });
});

describe("formatActivityTimestamp (PO review, round 2 — actor's timezone at write time)", () => {
  afterEach(() => setPreferredLocale(null));

  const ISO = "2026-06-28T13:00:00.000Z";

  it("uses the entry's captured timezone over the event's, when both are known", () => {
    setPreferredLocale("en-GB");
    // An admin managing a Bangalore event from Zurich should see that edit as CEST, not
    // IST — the entry's own captured timezone wins over the event's.
    const result = formatActivityTimestamp(ISO, "Europe/Warsaw", "Asia/Kolkata");
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/CEST|GMT\+2/);
  });

  it("falls back to the event's timezone when the entry has none captured", () => {
    setPreferredLocale("en-GB");
    // Pre-migration rows and non-browser write paths never had a timezone to capture —
    // those keep displaying in the event's own timezone, same as before this feature.
    const result = formatActivityTimestamp(ISO, null, "Europe/Warsaw");
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/CEST|GMT\+2/);
  });
});
