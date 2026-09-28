import { describe, expect, it } from "vitest";
import { isValidContactPhone, sanitizeContactPhoneInput } from "../src/contactPhone.js";

describe("isValidContactPhone", () => {
  it.each(["+48 123 456 789", "123456", "(555) 010-0199", "+1.555.010.0199", "  +48123456789  ", "112", "4321"])(
    "accepts %j",
    (value) => {
      expect(isValidContactPhone(value)).toBe(true);
    },
  );

  it.each([
    ["letters", "abc"],
    ["letters mixed in", "555 0100 ext 5"],
    ["too few digits", "12"],
    ["too many digits", "1234567890123456"],
    ["a plus in the middle", "48+123456789"],
    ["only punctuation", "( ) - ."],
    ["a URL scheme", "javascript:1234567"],
    ["a mailto suffix", "123456?cc=x@example.com"],
    ["too long overall", `${"1 ".repeat(30)}`],
    ["a newline inside", "123\n456"],
    ["a tab inside", "123\t456"],
    ["a non-breaking space", "123\u00a0456"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(isValidContactPhone(value)).toBe(false);
  });

  it("counts digits only, so separators do not help or hurt", () => {
    expect(isValidContactPhone("1-2-3-4-5-6")).toBe(true);
    expect(isValidContactPhone("1 2 3")).toBe(true);
    expect(isValidContactPhone("1 2")).toBe(false);
  });
});

describe("sanitizeContactPhoneInput", () => {
  it("drops letters and other characters a phone number never has", () => {
    expect(sanitizeContactPhoneInput("call 555 0100!")).toBe(" 555 0100");
    expect(sanitizeContactPhoneInput("abc")).toBe("");
  });

  it("keeps digits and the usual separators", () => {
    expect(sanitizeContactPhoneInput("(555) 010-0199.")).toBe("(555) 010-0199.");
  });

  it("turns any whitespace into a plain space and drops other control characters", () => {
    expect(sanitizeContactPhoneInput("555\t010\u00a00199")).toBe("555 010 0199");
    expect(sanitizeContactPhoneInput("555\n010\u0000")).toBe("555 010");
  });

  it("removes every plus unless a leading one is allowed", () => {
    expect(sanitizeContactPhoneInput("+48 123")).toBe("48 123");
    expect(sanitizeContactPhoneInput("+48 123", true)).toBe("+48 123");
  });

  it("keeps only the first plus, and only at the very start", () => {
    expect(sanitizeContactPhoneInput("48+123+456", true)).toBe("48123456");
    expect(sanitizeContactPhoneInput("++48", true)).toBe("+48");
  });
});
