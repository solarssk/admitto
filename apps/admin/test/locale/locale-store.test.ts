import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALE_TAGS } from "@admitto/shared";
import { LOCALE_OPTIONS } from "../../src/utils/locale-store.js";

describe("LOCALE_OPTIONS vs shared whitelist", () => {
  it("picker values match SUPPORTED_LOCALE_TAGS (no UI/backend drift)", () => {
    const pickerValues = LOCALE_OPTIONS.map((o) => o.value).filter(
      (v): v is string => v != null,
    );
    expect(pickerValues.sort()).toEqual([...SUPPORTED_LOCALE_TAGS].sort());
  });

  it("includes system default as null sentinel", () => {
    expect(LOCALE_OPTIONS.some((o) => o.value === null)).toBe(true);
  });
});
