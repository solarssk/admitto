import { describe, expect, it } from "vitest";
import type { AttendeeRowDto } from "../../src/api/types.js";
import {
  checkedInAmong,
  DEFAULT_REMOVAL_REASON,
  REMOVE_ARCHIVED_TOOLTIP,
  REMOVE_CHECKED_IN_LINE,
  removedCheckInsLine,
  removedToast,
} from "../../src/attendees/removeAttendee.js";

const row = (id: string, admittedAt: string | null): AttendeeRowDto => ({
  id,
  name: `Person ${id}`,
  email: `${id}@example.com`,
  company: null,
  department: null,
  ticket_type: "vip",
  status: "registered",
  check_in_status: admittedAt ? "admitted" : "not_admitted",
  admitted_at: admittedAt,
  updated_at: "2026-06-01T10:00:00.000Z",
  last_mail_status: null,
  last_mail_retryable: null,
  rsvp_status: "confirmed",
  has_issued_items: false,
  wallet_status: null,
});

describe("removedToast", () => {
  it.each([
    [{ removed: 1, not_found: 0 }, "Attendee removed from the event"],
    [{ removed: 3, not_found: 0 }, "3 people removed from the event"],
    [{ removed: 1, not_found: 1 }, "Attendee removed from the event. 1 was already gone."],
    [{ removed: 3, not_found: 2 }, "3 people removed from the event. 2 were already gone."],
    [{ removed: 0, not_found: 2 }, "Nobody was removed"],
    [{ removed: 0, not_found: 0 }, "Nobody was removed"],
  ])("%j reads %s", (answer, expected) => {
    expect(removedToast(answer)).toBe(expected);
  });
});

describe("the check-in warning", () => {
  it("says the check-in goes for one person, and the check-ins for several", () => {
    expect(REMOVE_CHECKED_IN_LINE).toBe("Already checked in. The check-in is removed from Reports too.");
    expect(removedCheckInsLine(1)).toBe("1 person has already checked in. The check-in is removed from Reports too.");
    expect(removedCheckInsLine(4)).toBe("4 people have already checked in. Their check-ins are removed from Reports too.");
  });

  it("counts only the selected people who have checked in", () => {
    const rows = [row("a", "2026-06-01T09:00:00.000Z"), row("b", null), row("c", "2026-06-01T09:30:00.000Z"), row("d", "2026-06-01T10:00:00.000Z")];

    expect(checkedInAmong(rows, new Set(["a", "b", "c"]))).toBe(2);
    expect(checkedInAmong(rows, new Set(["b"]))).toBe(0);
    expect(checkedInAmong(rows, new Set())).toBe(0);
    expect(checkedInAmong(rows, new Set(["a", "not-on-this-page"]))).toBe(1);
  });
});

describe("what the screens say", () => {
  it("starts from Duplicate entry, the commonest mistake", () => {
    expect(DEFAULT_REMOVAL_REASON).toBe("duplicate");
  });

  it("explains why Remove is off on an archived event and what to do for a privacy request", () => {
    expect(REMOVE_ARCHIVED_TOOLTIP).toBe(
      "This event is archived, so its numbers are final. To erase someone's personal data, use Erase personal data.",
    );
  });
});
