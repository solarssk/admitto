import { describe, expect, it } from "vitest";
import { peopleOnSiteBreakdown } from "../../src/utils/peopleOnSite.js";

describe("peopleOnSiteBreakdown", () => {
  it.each([
    [12, 2, "12 guests and 2 companions"],
    [1, 1, "1 guest and 1 companion"],
    [1, 3, "1 guest and 3 companions"],
    [4, 1, "4 guests and 1 companion"],
    [0, 2, "0 guests and 2 companions"],
  ])("says %i guests and %i companions as '%s'", (guests, companions, expected) => {
    expect(peopleOnSiteBreakdown(guests, companions)).toBe(expected);
  });
});
