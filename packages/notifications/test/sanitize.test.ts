import { describe, expect, it } from "vitest";
import { sanitizeNotificationMetadata, sanitizeNotificationText } from "../src/sanitize.js";

describe("sanitizeNotificationText", () => {
  it("redacts an email-like fragment", () => {
    expect(sanitizeNotificationText("contact attacker@example.com now")).not.toContain(
      "attacker@example.com",
    );
  });

  it("falls back to an empty string when there is nothing to sanitize", () => {
    expect(sanitizeNotificationText("")).toBe("");
  });
});

describe("sanitizeNotificationMetadata", () => {
  it("passes through undefined and non-string primitives unchanged", () => {
    expect(sanitizeNotificationMetadata(undefined)).toBeUndefined();
    expect(sanitizeNotificationMetadata({ count: 3, ok: true, when: null })).toEqual({
      count: 3,
      ok: true,
      when: null,
    });
  });

  it("sanitizes a top-level string value", () => {
    const result = sanitizeNotificationMetadata({ contact: "leak@example.com" });
    expect(result!.contact).not.toContain("leak@example.com");
  });

  it("sanitizes strings nested inside an object, at any depth", () => {
    const result = sanitizeNotificationMetadata({
      account: { email: "nested-leak@example.com" },
    });
    const account = result!.account as { email: string };
    expect(account.email).not.toContain("nested-leak@example.com");
  });

  it("sanitizes strings nested inside an array", () => {
    const result = sanitizeNotificationMetadata({
      recipients: ["array-leak@example.com", "second@example.com"],
    });
    const recipients = result!.recipients as string[];
    expect(recipients.join(" ")).not.toContain("array-leak@example.com");
    expect(recipients.join(" ")).not.toContain("second@example.com");
  });
});
