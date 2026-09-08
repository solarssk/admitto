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

  it("converts a RegExp to its sanitized source, instead of silently discarding it as {}", () => {
    const result = sanitizeNotificationMetadata({ pattern: /^admin-/ });
    expect(result!.pattern).toBe("^admin-");
  });

  it("converts a Map to a plain object with sanitized string keys, instead of silently discarding it as {} (Object.entries(new Map()) is always empty)", () => {
    const result = sanitizeNotificationMetadata({ counts: new Map([["admin", 3]]) });
    expect(result!.counts).toEqual({ admin: 3 });
  });

  it("converts a Set to a sanitized array, instead of silently discarding it as {} (Object.entries(new Set()) is always empty)", () => {
    const result = sanitizeNotificationMetadata({ roles: new Set(["admin", "leak@example.com"]) });
    const roles = result!.roles as string[];
    expect(roles[0]).toBe("admin");
    expect(roles[1]).not.toContain("leak@example.com");
  });

  it("still recurses via Object.entries into an ordinary class instance, since its real data lives in own enumerable properties (unlike Date/Error/Map/Set/RegExp)", () => {
    class IncidentContext {
      userId = "u-1";
      ip = "leak@example.com"; // deliberately email-shaped to prove it's still sanitized
    }
    const result = sanitizeNotificationMetadata({ context: new IncidentContext() });
    const context = result!.context as { userId: string; ip: string };
    expect(context.userId).toBe("u-1");
    expect(context.ip).not.toContain("leak@example.com");
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
