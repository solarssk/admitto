import { describe, expect, it } from "vitest";
import { isBadgeItemUsable } from "../src/event-items.js";

describe("isBadgeItemUsable", () => {
  it("is usable when enabled and issue_on_checkin is not explicitly false", () => {
    expect(isBadgeItemUsable(true, null)).toBe(true);
    expect(isBadgeItemUsable(true, {})).toBe(true);
    expect(isBadgeItemUsable(true, { issue_on_checkin: true })).toBe(true);
  });

  it("is unusable when disabled, regardless of config", () => {
    expect(isBadgeItemUsable(false, null)).toBe(false);
    expect(isBadgeItemUsable(false, { issue_on_checkin: true })).toBe(false);
  });

  it("is unusable when issue_on_checkin is explicitly false, even while enabled", () => {
    expect(isBadgeItemUsable(true, { issue_on_checkin: false })).toBe(false);
  });
});
