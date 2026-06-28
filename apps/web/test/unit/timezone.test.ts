import { describe, expect, it } from "vitest";
import { isValidIanaTimezone } from "../../src/admin/timezone.js";

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
