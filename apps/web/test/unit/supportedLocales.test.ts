import { describe, expect, it } from "vitest";
import {
  isSupportedLocale,
  sanitizePreferredLocale,
  SUPPORTED_LOCALE_TAGS,
} from "@admitto/shared";

describe("supportedLocales", () => {
  it("accepts whitelisted tags", () => {
    for (const tag of SUPPORTED_LOCALE_TAGS) {
      expect(isSupportedLocale(tag)).toBe(true);
      expect(sanitizePreferredLocale(tag)).toBe(tag);
    }
  });

  it("rejects tags outside the whitelist", () => {
    expect(isSupportedLocale("xx-ZZ")).toBe(false);
    expect(sanitizePreferredLocale("xx-ZZ")).toBeNull();
  });

  it("sanitizePreferredLocale returns null for invalid or empty", () => {
    expect(sanitizePreferredLocale(null)).toBeNull();
    expect(sanitizePreferredLocale(undefined)).toBeNull();
    expect(sanitizePreferredLocale("")).toBeNull();
    expect(sanitizePreferredLocale("xx-ZZ")).toBeNull();
    expect(sanitizePreferredLocale("  pl-PL  ")).toBe("pl-PL");
  });
});
