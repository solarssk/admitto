import { describe, expect, it } from "vitest";
import { shouldAutoAdvance } from "../../src/checkin/autoAdvance.js";
import type { AttendeeCardDto, AttendeeCardItemDto, CheckInScanResponse } from "../../src/api/types.js";

function item(overrides: Partial<AttendeeCardItemDto> = {}): AttendeeCardItemDto {
  return { key: "badge", label: "Badge", icon: null, state: "pending", actions: ["issued"], ...overrides };
}

function card(items: AttendeeCardItemDto[]): AttendeeCardDto {
  return {
    id: "att-1",
    name: "Alice Smith",
    company: null,
    department: null,
    ticket_type: null,
    check_in_status: "admitted",
    admitted_at: null,
    items,
    notes: [],
    blocked: false,
  };
}

const validConfirmed = (c: AttendeeCardDto): CheckInScanResponse => ({
  status: "VALID",
  confirmed: true,
  card: c,
});

describe("shouldAutoAdvance (#434)", () => {
  it("advances on desktop even with pending items — desktop behaviour unchanged", () => {
    expect(
      shouldAutoAdvance(validConfirmed(card([item()])), {
        autoAdvanceOnValid: true,
        showMobileOverlay: false,
      }),
    ).toBe(true);
  });

  it("does not advance on the mobile overlay when items still need an action", () => {
    expect(
      shouldAutoAdvance(validConfirmed(card([item()])), {
        autoAdvanceOnValid: true,
        showMobileOverlay: true,
      }),
    ).toBe(false);
  });

  it("does not advance on the mobile overlay for an already-issued item — the handover reminder still needs to show (Bugbot)", () => {
    expect(
      shouldAutoAdvance(validConfirmed(card([item({ actions: [] })])), {
        autoAdvanceOnValid: true,
        showMobileOverlay: true,
      }),
    ).toBe(false);
  });

  it("advances on the mobile overlay when there are no items at all", () => {
    expect(
      shouldAutoAdvance(validConfirmed(card([])), {
        autoAdvanceOnValid: true,
        showMobileOverlay: true,
      }),
    ).toBe(true);
  });

  it("advances on the mobile overlay when the response has no card at all", () => {
    expect(
      shouldAutoAdvance(
        { status: "VALID", confirmed: true },
        { autoAdvanceOnValid: true, showMobileOverlay: true },
      ),
    ).toBe(true);
  });

  it("never advances when the setting is off", () => {
    expect(
      shouldAutoAdvance(validConfirmed(card([])), {
        autoAdvanceOnValid: false,
        showMobileOverlay: true,
      }),
    ).toBe(false);
  });

  it("never advances for non-VALID or unconfirmed responses", () => {
    expect(
      shouldAutoAdvance(
        { status: "ALREADY_CHECKED_IN", confirmed: true, card: card([]) },
        { autoAdvanceOnValid: true, showMobileOverlay: false },
      ),
    ).toBe(false);
    expect(
      shouldAutoAdvance(
        { status: "VALID", confirmed: false, card: card([]) },
        { autoAdvanceOnValid: true, showMobileOverlay: false },
      ),
    ).toBe(false);
  });
});
