import { afterEach, describe, expect, it } from "vitest";
import {
  deriveAttendeeSource,
  formatActivityTimestamp,
  getTimelineActor,
  getTimelineDetail,
  getTimelineIcon,
  getTimelineLabel,
  getTimelineTone,
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
        client_timezone: null,
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
        client_timezone: null,
      }),
    ).toBe("Item reset to pending");
  });
});

describe("item_issued/item_state_changed timeline label (PO review)", () => {
  it("says 'Item issued' generically instead of the old hardcoded 'Badge/Gift bag issued'", () => {
    // Event-day items are a configurable registry (any admin-defined item, not just a fixed
    // Badge/Gift bag pair) - the old label was a leftover from before that, and read as wrong
    // for any other configured item (e.g. "Gratis"). The detail line already names the actual
    // item; the headline just needs to be generic, matching "Item returned"/"Item reset to
    // pending" right next to it.
    for (const actionType of ["item_issued", "item_state_changed"]) {
      expect(
        getTimelineLabel({
          id: "log-1",
          action_type: actionType,
          actor_display: "admin",
          metadata: null,
          created_at: "2026-06-28T13:00:00.000Z",
          client_timezone: null,
        }),
      ).toBe("Item issued");
    }
  });
});

describe("getTimelineLabel — full action_type coverage (Codecov review)", () => {
  function labelEntry(action_type: string, metadata: Record<string, unknown> | null = null) {
    return {
      id: "log-1",
      action_type,
      actor_display: "admin",
      metadata,
      created_at: "2026-06-28T13:00:00.000Z",
      client_timezone: null,
    };
  }

  it.each([
    ["attendee_created_manual", "Created manually"],
    ["attendees_imported", "Imported from CSV"],
    ["attendee_imported", "Imported from CSV"],
    ["mail_bulk_resend", "Bulk ticket send"],
    ["attendee_ingested", "Ingested via API"],
    ["ticket_sent", "Ticket sent"],
    ["mail_delivered", "Email delivered"],
    ["mail_bounced", "Email bounced"],
    ["ticket_resent", "Ticket resent"],
    ["resend_ticket", "Ticket resent"],
    ["check_in", "Checked in"],
    ["admitted", "Checked in"],
    ["check_in_undo", "Check-in undone"],
    ["check_in_undone", "Check-in undone"],
    ["note_added", "Note added"],
    ["note_updated", "Note updated"],
    ["note_deleted", "Note deleted"],
    ["item_returned", "Item returned"],
    ["attendee_edited", "Profile updated"],
    ["pass_revoked", "Pass revoked"],
    ["pass_restored", "Pass restored"],
    ["scan_preview", "Scan preview"],
  ])("maps %s to %s", (actionType, expected) => {
    expect(getTimelineLabel(labelEntry(actionType))).toBe(expected);
  });

  it("falls back to a humanized raw action_type for anything unrecognized", () => {
    expect(getTimelineLabel(labelEntry("some_future_action"))).toBe("some future action");
  });

  it("shows the RSVP target status, defaulting to 'updated' when metadata has none", () => {
    expect(getTimelineLabel(labelEntry("rsvp_status_changed", { to: "declined" }))).toBe(
      "Status changed to Declined",
    );
    expect(getTimelineLabel(labelEntry("rsvp_status_changed"))).toBe("Status changed to updated");
  });

  it("falls back to the raw value for an unrecognized RSVP target status", () => {
    expect(
      getTimelineLabel(labelEntry("rsvp_status_changed", { to: "some_future_status" })),
    ).toBe("Status changed to some_future_status");
  });
});

describe("getTimelineIcon — unrecognized action_type (Codecov review)", () => {
  it.each([
    ["note_updated", "pencil"],
    ["note_deleted", "trash"],
  ])("maps %s to %s", (actionType, expected) => {
    expect(getTimelineIcon(actionType)).toBe(expected);
  });

  it("falls back to a generic history icon", () => {
    expect(getTimelineIcon("some_future_action")).toBe("history");
  });
});

describe("deriveAttendeeSource (Codecov review — previously unimported/untested)", () => {
  it("returns null for an empty action log", () => {
    expect(deriveAttendeeSource([])).toBeNull();
  });

  it("returns null when the oldest entry's action_type has no configured source label", () => {
    expect(
      deriveAttendeeSource([
        {
          id: "log-1",
          action_type: "attendee_edited",
          actor_display: "admin",
          metadata: null,
          created_at: "2026-06-28T13:00:00.000Z",
          client_timezone: null,
        },
      ]),
    ).toBeNull();
  });

  it("reads the source off the oldest (last) entry, not the newest", () => {
    expect(
      deriveAttendeeSource([
        {
          id: "log-2",
          action_type: "rsvp_status_changed",
          actor_display: "admin",
          metadata: null,
          created_at: "2026-06-29T13:00:00.000Z",
          client_timezone: null,
        },
        {
          id: "log-1",
          action_type: "attendees_imported",
          actor_display: null,
          metadata: null,
          created_at: "2026-06-28T13:00:00.000Z",
          client_timezone: null,
        },
      ]),
    ).toBe("CSV/XLSX import");
  });
});

describe("getTimelineActor (PO review — actor moved next to the timestamp)", () => {
  it("returns the actor's display name", () => {
    expect(
      getTimelineActor({
        id: "log-1",
        action_type: "check_in",
        actor_display: "operator 1",
        metadata: null,
        created_at: "2026-06-28T13:00:00.000Z",
        client_timezone: null,
      }),
    ).toBe("operator 1");
  });

  it("falls back to System when there's no actor_display", () => {
    expect(
      getTimelineActor({
        id: "log-1",
        action_type: "attendee_ingested",
        actor_display: null,
        metadata: null,
        created_at: "2026-06-28T13:00:00.000Z",
        client_timezone: null,
      }),
    ).toBe("System");
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
        client_timezone: null,
      }),
    ).toBe("Registered → Confirmed");
  });

  it("falls back to the raw value for an unrecognized RSVP status on either side", () => {
    expect(
      getTimelineDetail({
        id: "log-1",
        action_type: "rsvp_status_changed",
        actor_display: "Admin",
        metadata: { from: "some_future_status", to: "confirmed" },
        created_at: "2026-06-28T13:00:00.000Z",
        client_timezone: null,
      }),
    ).toBe("some_future_status → Confirmed");
  });

  it("returns empty when rsvp_status_changed metadata is missing from/to (falls through to no other branch matching)", () => {
    expect(
      getTimelineDetail({
        id: "log-1",
        action_type: "rsvp_status_changed",
        actor_display: "Admin",
        metadata: {},
        created_at: "2026-06-28T13:00:00.000Z",
        client_timezone: null,
      }),
    ).toBe("");
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
      client_timezone: null,
      ...overrides,
    };
  }

  it("lists changed field names for attendee_edited, not raw values (PII-safe)", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "attendee_edited", metadata: { fields: ["email", "company"] } }),
      ),
    ).toBe("Email, Company");
  });

  it("shows before/after values for the safe subset the backend captured (PO review, round 2)", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["email", "company"],
            field_changes: {
              email: { from: "old@example.com", to: "new@example.com" },
              company: { from: "Old Co", to: "New Co" },
            },
          },
        }),
      ),
    ).toBe("Email: old@example.com → new@example.com, Company: Old Co → New Co");
  });

  it("shows a dash for a null before/after value in a captured change (e.g. company set for the first time)", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["company"],
            field_changes: { company: { from: null, to: "New Co" } },
          },
        }),
      ),
    ).toBe("Company: - → New Co");
  });

  it("shows a dash when a captured value is cleared", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["company"],
            field_changes: { company: { from: "Old Co", to: null } },
          },
        }),
      ),
    ).toBe("Company: Old Co → -");
  });

  it("resolves ticket_type from/to keys to the catalog's current labels, not the raw immutable key", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["ticket_type"],
            field_changes: { ticket_type: { from: "standard", to: "vip" } },
          },
        }),
        [],
        [],
        [
          { id: "tt-1", key: "standard", label: "Standard", color: "gray", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
          { id: "tt-2", key: "vip", label: "VIP", color: "purple", sort_order: 1, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" },
        ],
      ),
    ).toBe("Ticket type: Standard → VIP");
  });

  it("falls back to the raw ticket_type key when it's no longer in the catalog (type since deleted)", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["ticket_type"],
            field_changes: { ticket_type: { from: "standard", to: "new_type" } },
          },
        }),
        [],
        [],
        [{ id: "tt-1", key: "standard", label: "Standard", color: "gray", sort_order: 0, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" }],
      ),
    ).toBe("Ticket type: Standard → new_type");
  });

  it("falls back to the raw ticket_type key on the from-side too, independently of the to-side lookup", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["ticket_type"],
            field_changes: { ticket_type: { from: "deleted_type", to: "vip" } },
          },
        }),
        [],
        [],
        [{ id: "tt-2", key: "vip", label: "VIP", color: "purple", sort_order: 1, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" }],
      ),
    ).toBe("Ticket type: deleted_type → VIP");
  });

  it("shows a dash for a null ticket_type side without resolving it against the catalog (Codecov review)", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["ticket_type"],
            field_changes: { ticket_type: { from: null, to: "vip" } },
          },
        }),
        [],
        [],
        [{ id: "tt-2", key: "vip", label: "VIP", color: "purple", sort_order: 1, attendee_count: 1, created_at: "2026-01-01T00:00:00.000Z" }],
      ),
    ).toBe("Ticket type: - → VIP");
  });

  it("falls back to the field name alone for a malformed field_changes shape, instead of throwing (Codecov review, fieldValueChange defensive branches)", () => {
    // field_changes itself isn't an object.
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: { fields: ["email"], field_changes: "not-an-object" },
        }),
      ),
    ).toBe("Email");
    // field_changes[key] isn't an object.
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: { fields: ["email"], field_changes: { email: "not-an-object" } },
        }),
      ),
    ).toBe("Email");
    // from/to are neither string nor null (e.g. a stray number from a malformed write).
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: { fields: ["email"], field_changes: { email: { from: 1, to: "x" } } },
        }),
      ),
    ).toBe("Email");
  });

  it("falls back to the field name alone when field_changes has nothing for it - name and custom_data stay values-never-shown (PII-safe)", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "attendee_edited",
          metadata: {
            fields: ["name", "shirt_size", "email"],
            field_changes: { email: { from: "old@example.com", to: "new@example.com" } },
          },
        }),
      ),
    ).toBe("Name, Shirt size, Email: old@example.com → new@example.com");
  });

  it("humanizes an unlabeled custom_data field key for attendee_edited", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "attendee_edited", metadata: { fields: ["shirt_size"] } }),
      ),
    ).toBe("Shirt size");
  });

  it("uses the registry's real label for a configured custom field, not a humanized guess at its slugified key (PO review)", () => {
    // "niepe_nosprawnosc" is the slugified source_field for "Niepełnosprawność" - diacritics
    // are already gone from the key itself, so humanizing it can never recover "Niepełnosprawność".
    expect(
      getTimelineDetail(
        entry({ action_type: "attendee_edited", metadata: { fields: ["niepe_nosprawnosc"] } }),
        [{ label: "Niepełnosprawność", source_field: "niepe_nosprawnosc", type: "boolean", required: false }],
      ),
    ).toBe("Niepełnosprawność");
  });

  it("returns an empty string when attendee_edited has no fields metadata (actor is shown separately, via getTimelineActor)", () => {
    expect(getTimelineDetail(entry({ action_type: "attendee_edited", metadata: null }))).toBe("");
  });

  it("shows the pass status transition for pass_revoked", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "pass_revoked",
          metadata: { previous_status: "registered" },
        }),
      ),
    ).toBe("Active → Revoked");
  });

  it("falls back to the raw status string for an unrecognized previous_status value", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "pass_revoked",
          metadata: { previous_status: "some_future_status" },
        }),
      ),
    ).toBe("some_future_status → Revoked");
  });

  it("shows the pass status transition for pass_restored", () => {
    expect(
      getTimelineDetail(
        entry({
          action_type: "pass_restored",
          metadata: { previous_status: "revoked" },
        }),
      ),
    ).toBe("Revoked → Active");
  });

  it("shows the humanized event item key for item_issued/item_returned/item_revoked", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "item_issued", metadata: { event_item_key: "badge" } }),
      ),
    ).toBe("Badge");
    expect(
      getTimelineDetail(
        entry({
          action_type: "item_returned",
          metadata: { event_item_key: "gift_bag", from_state: "issued", to_state: "returned" },
        }),
      ),
    ).toBe("Gift bag");
    expect(
      getTimelineDetail(
        entry({
          action_type: "item_revoked",
          metadata: { event_item_key: "badge", from_state: "issued", to_state: "pending" },
        }),
      ),
    ).toBe("Badge");
  });

  it("uses the item's real registry label over a humanized guess at its key (PO review)", () => {
    // "gratis" humanizes to "Gratis" by coincidence, matching the configured label - but the
    // registry lookup must still be what actually produces it, not the humanize fallback, since
    // most keys (e.g. "gift_bag") don't humanize to their real label ("Gift bag" vs "Gift bag" is
    // a coincidence too; a differently-worded label like "Free gift" would expose the bug).
    expect(
      getTimelineDetail(
        entry({ action_type: "item_issued", metadata: { event_item_key: "gratis" } }),
        [],
        [{ key: "gratis", label: "Free gift", icon: null, state: "issued" }],
      ),
    ).toBe("Free gift");
  });

  it("falls back to humanizing the key when the item isn't in the registry (e.g. removed after this log entry was written)", () => {
    expect(
      getTimelineDetail(
        entry({ action_type: "item_issued", metadata: { event_item_key: "gratis" } }),
        [],
        [],
      ),
    ).toBe("Gratis");
  });
});

describe("formatActivityTimestamp (PO review, round 2 — actor's timezone at write time)", () => {
  afterEach(() => setPreferredLocale(null));

  const ISO = "2026-06-28T13:00:00.000Z";

  it("uses the entry's captured timezone over the event's, when both are known", () => {
    setPreferredLocale("en-GB");
    // An admin managing a Bangalore event from Zurich should see that edit in Warsaw's
    // offset (UTC+2), not Kolkata's — the entry's own captured timezone wins over the
    // event's. A single numeric offset (not a locale-dependent "CEST"/"GMT+2" split) is
    // deterministic regardless of the viewer's own locale.
    const result = formatActivityTimestamp(ISO, "Europe/Warsaw", "Asia/Kolkata");
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/UTC\+2/);
  });

  it("falls back to the event's timezone when the entry has none captured", () => {
    setPreferredLocale("en-GB");
    // Pre-migration rows and non-browser write paths never had a timezone to capture —
    // those keep displaying in the event's own timezone, same as before this feature.
    const result = formatActivityTimestamp(ISO, null, "Europe/Warsaw");
    expect(result).toMatch(/15:00/);
    expect(result).toMatch(/UTC\+2/);
  });
});

describe("getTimelineTone (PO review — colored icons to distinguish outcomes)", () => {
  function entry(action_type: string, metadata: Record<string, unknown> | null = null) {
    return {
      id: "log-1",
      action_type,
      actor_display: "operator 1",
      metadata,
      created_at: "2026-06-28T13:00:00.000Z",
      client_timezone: null,
    };
  }

  it("marks a positive outcome ok", () => {
    expect(getTimelineTone(entry("check_in"))).toBe("ok");
    expect(getTimelineTone(entry("item_issued"))).toBe("ok");
    expect(getTimelineTone(entry("pass_restored"))).toBe("ok");
  });

  it("marks a negative outcome error", () => {
    expect(getTimelineTone(entry("check_in_revoked"))).toBe("error");
    expect(getTimelineTone(entry("pass_revoked"))).toBe("error");
    expect(getTimelineTone(entry("mail_bounced"))).toBe("error");
  });

  it("marks routine/informational rows neutral by default", () => {
    expect(getTimelineTone(entry("attendee_edited"))).toBe("neutral");
    expect(getTimelineTone(entry("attendees_imported"))).toBe("neutral");
    expect(getTimelineTone(entry("note_added"))).toBe("neutral");
  });

  it("varies rsvp_status_changed by its own target status, not a fixed tone", () => {
    expect(getTimelineTone(entry("rsvp_status_changed", { to: "confirmed" }))).toBe("ok");
    expect(getTimelineTone(entry("rsvp_status_changed", { to: "declined" }))).toBe("error");
    expect(getTimelineTone(entry("rsvp_status_changed", { to: "tentative" }))).toBe("warn");
    expect(getTimelineTone(entry("rsvp_status_changed", { to: "none" }))).toBe("neutral");
  });

  it("treats a missing or non-string rsvp target status as neutral instead of throwing (Codecov review)", () => {
    expect(getTimelineTone(entry("rsvp_status_changed", null))).toBe("neutral");
    expect(getTimelineTone(entry("rsvp_status_changed", {}))).toBe("neutral");
  });
});
