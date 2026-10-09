import { describe, expect, it } from "vitest";
import {
  anonymousEntries,
  ERASED_ATTENDEE_LABEL,
  ERASED_NOT_SELECTABLE_LABEL,
  erasedCheckInParts,
  erasedOnLabel,
  erasedToast,
  erasedWalletChipLabel,
  erasureFreesPlace,
  hiddenErasedLine,
  peopleCount,
  rowIdentity,
  selectRowLabel,
  shownErasedLine,
} from "../../src/attendees/erasedAttendee.js";

describe("counts in words", () => {
  it("uses the singular for one and the plural otherwise", () => {
    expect(peopleCount(1)).toBe("1 person");
    expect(peopleCount(12)).toBe("12 people");
    expect(anonymousEntries(1)).toBe("1 anonymous entry");
    expect(anonymousEntries(12)).toBe("12 anonymous entries");
  });

  it("words the line under the list for one erased entry and for several", () => {
    expect(hiddenErasedLine(1)).toBe("1 erased entry is hidden. Reports still count it.");
    expect(hiddenErasedLine(2)).toBe("2 erased entries are hidden. Reports still count them.");
    expect(shownErasedLine(1)).toBe("Showing 1 erased entry. Reports count it too.");
    expect(shownErasedLine(2)).toBe("Showing 2 erased entries. Reports count them too.");
  });
});

describe("erasedToast", () => {
  it.each([
    [{ erased: 1, already_erased: 0 }, "Personal data erased"],
    [{ erased: 3, already_erased: 1 }, "Personal data of 3 people erased"],
    [{ erased: 0, already_erased: 2 }, "Already erased"],
    [{ erased: 0, already_erased: 0 }, "Nobody was erased"],
  ])("%j says %s", (result, message) => {
    expect(erasedToast(result)).toBe(message);
  });
});

describe("erasureFreesPlace", () => {
  it.each([
    ["registered", null, false, true],
    ["confirmed", null, false, true],
    ["cancelled", null, false, false],
    ["revoked", null, false, false],
    ["registered", "2026-09-01T10:00:00.000Z", false, false],
    ["registered", null, true, false],
  ] as const)("%s, admitted %s, archived %s: %s", (status, admittedAt, archived, expected) => {
    expect(erasureFreesPlace({ status, admitted_at: admittedAt }, archived)).toBe(expected);
  });
});

describe("list rows", () => {
  const live = { name: "Jane Doe", email: "jane@example.com", erased_at: null };
  const gone = { name: "Placeholder", email: "erased-x@erased.invalid", erased_at: "2026-10-08T12:00:00.000Z" };

  it("shows a live row as it is", () => {
    expect(rowIdentity(live, "UTC")).toEqual({ erased: false, name: "Jane Doe", detail: "jane@example.com" });
    expect(selectRowLabel(live)).toBe("Select Jane Doe");
  });

  it("never shows the placeholders of an erased row", () => {
    const identity = rowIdentity(gone, "UTC");
    expect(identity.erased).toBe(true);
    expect(identity.name).toBe(ERASED_ATTENDEE_LABEL);
    expect(identity.detail).toMatch(/^Erased on .*2026/);
    expect(identity.detail).toBe(erasedOnLabel(gone.erased_at, "UTC"));
    expect(selectRowLabel(gone)).toBe(ERASED_NOT_SELECTABLE_LABEL);
  });

  it("treats a row without the field, as older fixtures have it, as live", () => {
    expect(rowIdentity({ name: "A", email: "a@example.com" }, "UTC").erased).toBe(false);
  });
});

describe("erasedWalletChipLabel", () => {
  it.each([
    [{ wallet_pass: { provider_removed_at: "2026-10-08T12:00:00.000Z" }, wallet_pass_delete_pending: false }, "Pass removed"],
    [{ wallet_pass: { provider_removed_at: null }, wallet_pass_delete_pending: true }, "To be deleted"],
    [{ wallet_pass: { provider_removed_at: null }, wallet_pass_delete_pending: false }, "No pass"],
    [{ wallet_pass: null, wallet_pass_delete_pending: undefined }, "No pass"],
  ])("%j reads %s", (detail, label) => {
    expect(erasedWalletChipLabel(detail as never)).toBe(label);
  });
});

describe("erasedCheckInParts", () => {
  it("reads Around HH:MM in the event's zone, without the UTC offset", () => {
    const parts = erasedCheckInParts("2026-09-01T08:00:00.000Z", "Europe/Warsaw");

    expect(parts?.time).toMatch(/^Around 10:00/);
    expect(parts?.time).not.toMatch(/UTC/);
    expect(parts?.day).toMatch(/2026/);
  });

  it("has nothing to show for an attendee who was never admitted", () => {
    expect(erasedCheckInParts(null, "Europe/Warsaw")).toBeNull();
  });

  it("follows the event's zone: the same instant is another hour elsewhere", () => {
    expect(erasedCheckInParts("2026-09-01T08:00:00.000Z", "America/New_York")?.time).toMatch(/^Around 04:00/);
  });
});
