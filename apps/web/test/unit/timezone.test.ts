import { describe, expect, it, vi } from "vitest";
import { isValidIanaTimezone, parseOptionalClientTimezone } from "../../src/admin/timezone.js";

describe("isValidIanaTimezone", () => {
  it("accepts UTC", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it.each(["Etc/UTC", "UCT", "Zulu"])("accepts and normalizes the UTC alias %s", (alias) => {
    expect(isValidIanaTimezone(alias)).toBe(true);
    expect(parseOptionalClientTimezone(alias)).toBe("UTC");
  });

  it("accepts canonical IANA zones", () => {
    expect(isValidIanaTimezone("Europe/Warsaw")).toBe(true);
  });

  it("accepts aliases normalized by ICU (Asia/Kolkata → Asia/Calcutta)", () => {
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
  });

  it("accepts a catalogue alias when ICU omits it from supportedValuesOf", () => {
    const supportedValuesOf = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue([]);
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
    supportedValuesOf.mockRestore();
  });

  it("uses ICU validation when supportedValuesOf is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf");
    Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: undefined });
    try {
      expect(isValidIanaTimezone("Europe/Warsaw")).toBe(true);
    } finally {
      Object.defineProperty(Intl, "supportedValuesOf", descriptor!);
    }
  });

  it("rejects bogus zones", () => {
    expect(isValidIanaTimezone("Mars/Olympus")).toBe(false);
  });

  it("rejects offset-style strings", () => {
    expect(isValidIanaTimezone("+05:30")).toBe(false);
  });
});

describe("parseOptionalClientTimezone", () => {
  it("returns null for missing or blank input", () => {
    expect(parseOptionalClientTimezone(undefined)).toBeNull();
    expect(parseOptionalClientTimezone(null)).toBeNull();
    expect(parseOptionalClientTimezone("  ")).toBeNull();
  });

  it("returns a valid IANA zone", () => {
    expect(parseOptionalClientTimezone("Europe/Warsaw")).toBe("Europe/Warsaw");
  });

  it("normalizes a valid legacy IANA alias", () => {
    expect(parseOptionalClientTimezone("Asia/Calcutta")).toBe("Asia/Kolkata");
  });

  it("rejects invalid zones", () => {
    expect(parseOptionalClientTimezone("Mars/Olympus")).toBeNull();
  });

  it("preserves an ICU-valid zone while a newer catalogue is not yet bundled", async () => {
    vi.resetModules();
    vi.doMock("@admitto/shared/timezones", () => ({ normalizeTimeZone: () => null }));
    try {
      const timezone = await import("../../src/admin/timezone.js");
      expect(timezone.parseOptionalClientTimezone("Europe/Warsaw")).toBe("Europe/Warsaw");
      expect(timezone.timezoneField.parse("Europe/Warsaw")).toBe("Europe/Warsaw");
    } finally {
      vi.doUnmock("@admitto/shared/timezones");
      vi.resetModules();
    }
  });
});
