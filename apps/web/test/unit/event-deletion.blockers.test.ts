import { describe, expect, it } from "vitest";
import {
  isEventDeletable,
  listEventDeletionBlockers,
  type EventActivitySignals,
} from "../../src/admin/event-deletion.js";

const emptySignals: EventActivitySignals = {
  attendeeCount: 0,
  nonBadgeItemCount: 0,
  nonStandardTicketTypeCount: 0,
  contactCount: 0,
  resourceCount: 0,
  eventMailTemplateCount: 0,
};

describe("listEventDeletionBlockers / isEventDeletable", () => {
  it("returns no blockers for an empty event (active or archived)", () => {
    expect(listEventDeletionBlockers({ pinned_note: null }, emptySignals)).toEqual([]);
    expect(isEventDeletable({ archived_at: null, pinned_note: null }, emptySignals)).toBe(true);
    expect(
      isEventDeletable({ archived_at: new Date(), pinned_note: null }, emptySignals),
    ).toBe(true);
  });

  it("lists each remaining content signal and pinned note", () => {
    const blockers = listEventDeletionBlockers(
      { pinned_note: "Remember exits" },
      {
        attendeeCount: 2,
        nonBadgeItemCount: 1,
        nonStandardTicketTypeCount: 1,
        contactCount: 1,
        resourceCount: 1,
        eventMailTemplateCount: 1,
      },
    );
    expect(blockers).toEqual([
      "attendees",
      "custom_items",
      "custom_ticket_types",
      "contacts",
      "resources",
      "pinned_note",
      "event_mail_template",
    ]);
    expect(
      isEventDeletable(
        { archived_at: null, pinned_note: "Remember exits" },
        {
          attendeeCount: 2,
          nonBadgeItemCount: 1,
          nonStandardTicketTypeCount: 1,
          contactCount: 1,
          resourceCount: 1,
          eventMailTemplateCount: 1,
        },
      ),
    ).toBe(false);
  });

  it("treats empty string pinned note as a blocker (non-null)", () => {
    expect(listEventDeletionBlockers({ pinned_note: "" }, emptySignals)).toEqual(["pinned_note"]);
  });
});
