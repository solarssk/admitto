import { describe, expect, it } from "vitest";
import { canRevokeCheckIn } from "../../src/checkin/revokeEligibility.js";

describe("canRevokeCheckIn", () => {
  it("is eligible only when admitted and not blocked", () => {
    expect(canRevokeCheckIn({ checkInStatus: "admitted", blocked: false })).toBe(true);
  });

  it("is not eligible when not admitted", () => {
    expect(canRevokeCheckIn({ checkInStatus: "not_admitted", blocked: false })).toBe(false);
  });

  it("is not eligible when blocked, even if admitted (stale admitted_at on a revoked pass)", () => {
    expect(canRevokeCheckIn({ checkInStatus: "admitted", blocked: true })).toBe(false);
  });
});
