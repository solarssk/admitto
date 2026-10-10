import { describe, expect, it } from "vitest";
import type { EnabledWalletPlatforms } from "@admitto/shared";
import { hasWalletStatusChip } from "../../src/attendees/walletStatusChip.js";

const platforms = (apple: boolean, google: boolean, samsung: boolean): EnabledWalletPlatforms => ({ apple, google, samsung, any: apple || google });

describe("hasWalletStatusChip", () => {
  it("is false when the event offers no wallet platform", () => {
    expect(hasWalletStatusChip(platforms(false, false, false))).toBe(false);
  });

  it("is true for each platform alone, Samsung included (the chip reads its registration data like Apple's and Google's)", () => {
    expect(hasWalletStatusChip(platforms(true, false, false))).toBe(true);
    expect(hasWalletStatusChip(platforms(false, true, false))).toBe(true);
    expect(hasWalletStatusChip(platforms(false, false, true))).toBe(true);
  });
});
