import { describe, expect, it } from "vitest";
import { scanResultFromCard } from "../../src/checkin/cardScanResult.js";
import type { AttendeeCardDto } from "../../src/api/types.js";

function card(overrides: Partial<AttendeeCardDto> = {}): AttendeeCardDto {
  return {
    id: "att-1",
    name: "Anna Alpha",
    company: null,
    department: null,
    ticket_type: "vip",
    check_in_status: "not_admitted",
    admitted_at: null,
    items: [],
    notes: [],
    warnings: [],
    ...overrides,
  };
}

describe("scanResultFromCard (#379)", () => {
  it("clean not-admitted card derives PREVIEW awaiting confirm", () => {
    const c = card();
    expect(scanResultFromCard(c)).toEqual({
      status: "PREVIEW",
      confirmed: false,
      card: c,
      attendeeId: "att-1",
    });
  });

  it("admitted card derives ALREADY_CHECKED_IN with the entry time", () => {
    const c = card({ check_in_status: "admitted", admitted_at: "2026-09-01T09:44:00.000Z" });
    expect(scanResultFromCard(c)).toEqual({
      status: "ALREADY_CHECKED_IN",
      confirmed: true,
      card: c,
      attendeeId: "att-1",
      admittedAt: "2026-09-01T09:44:00.000Z",
    });
  });

  it("card with warnings derives REVOKED", () => {
    const c = card({ warnings: ["Ticket is not admittable (status: revoked)."] });
    expect(scanResultFromCard(c).status).toBe("REVOKED");
    expect(scanResultFromCard(c).confirmed).toBe(true);
  });

  it("warnings take precedence over an earlier admission (voided pass reads as revoked)", () => {
    const c = card({
      check_in_status: "admitted",
      admitted_at: "2026-09-01T09:44:00.000Z",
      warnings: ["Ticket is not admittable (status: revoked)."],
    });
    expect(scanResultFromCard(c).status).toBe("REVOKED");
  });

  it("admitted card without admitted_at omits admittedAt", () => {
    const c = card({ check_in_status: "admitted", admitted_at: null });
    expect(scanResultFromCard(c).admittedAt).toBeUndefined();
  });
});
