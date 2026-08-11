import { describe, expect, it } from "vitest";
import { isValidIanaTimezone, parseOptionalClientTimezone } from "../../src/admin/timezone.js";

describe("isValidIanaTimezone", () => {
  it("accepts UTC", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
  });

  it("accepts canonical IANA zones", () => {
    expect(isValidIanaTimezone("Europe/Warsaw")).toBe(true);
  });

  it("accepts aliases normalized by ICU (Asia/Kolkata → Asia/Calcutta)", () => {
    expect(isValidIanaTimezone("Asia/Kolkata")).toBe(true);
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
});
