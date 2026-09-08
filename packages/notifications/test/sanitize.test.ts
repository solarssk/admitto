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

  it("converts a Date to its ISO string instead of {} - Object.entries(new Date()) is always empty", () => {
    const when = new Date("2026-01-15T10:30:00.000Z");
    const result = sanitizeNotificationMetadata({ occurredAt: when });
    expect(result!.occurredAt).toBe("2026-01-15T10:30:00.000Z");
  });

  it("converts an Error to its sanitized message instead of {} - Object.entries(new Error()) is always empty", () => {
    const result = sanitizeNotificationMetadata({ cause: new Error("db said no") });
    expect(result!.cause).toBe("db said no");
  });

  it("sanitizes an email-shaped Error message the same way a plain string would be", () => {
    const result = sanitizeNotificationMetadata({ cause: new Error("failed for leak@example.com") });
    expect(result!.cause).not.toContain("leak@example.com");
  });

  it("falls back to a sanitized String() for any other non-plain object, instead of silently discarding it as {}", () => {
    const result = sanitizeNotificationMetadata({ pattern: /^admin-/ });
    expect(result!.pattern).toBe("/^admin-/");
  });

  it("still recurses into a genuinely plain object nested next to a Date/Error sibling", () => {
    const result = sanitizeNotificationMetadata({
      occurredAt: new Date("2026-01-15T10:30:00.000Z"),
      account: { email: "nested-leak@example.com" },
    });
    expect(result!.occurredAt).toBe("2026-01-15T10:30:00.000Z");
    const account = result!.account as { email: string };
    expect(account.email).not.toContain("nested-leak@example.com");
  });
});
