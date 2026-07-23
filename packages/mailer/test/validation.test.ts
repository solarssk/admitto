import { describe, expect, it } from "vitest";
import { validateMailMessage } from "../src/validation.js";

describe("validateMailMessage", () => {
  const valid = { to: "jan@example.com", subject: "Hi", html: "<p>x</p>" };

  it("accepts a minimal valid message", () => {
    expect(validateMailMessage(valid)).toBeUndefined();
  });

  it("rejects multiple to recipients", () => {
    expect(validateMailMessage({ ...valid, to: "a@example.com, b@example.com" })).toMatch(/exactly one/);
  });

  it("rejects invalid to address", () => {
    expect(validateMailMessage({ ...valid, to: "not-an-email" })).toMatch(/valid email/);
  });

  it("rejects a malformed single to address that the RFC parser still recognizes", () => {
    expect(validateMailMessage({ ...valid, to: "not-an-email@example" })).toMatch(/valid email/);
  });

  it("rejects CRLF in subject", () => {
    expect(validateMailMessage({ ...valid, subject: "Hi\r\nBcc: evil@example.com" })).toMatch(/subject/);
  });

  it.each([
    ["to", { ...valid, to: "jan@example.com\nBcc: evil@example.com" }],
    ["cc", { ...valid, cc: "audit@example.com\r\nBcc: evil@example.com" }],
    ["replyTo", { ...valid, replyTo: "reply@example.com\0Bcc: evil@example.com" }],
  ])("rejects control characters in %s", (_field, message) => {
    expect(validateMailMessage(message)).toMatch(/must not contain control characters/);
  });

  it("accepts RFC5322 cc and validates each address", () => {
    expect(
      validateMailMessage({
        ...valid,
        cc: '"Audit, Team" <audit@example.com>, ops@example.com',
      }),
    ).toBeUndefined();
  });

  it("rejects empty and invalid cc lists", () => {
    expect(validateMailMessage({ ...valid, cc: " , " })).toMatch(/at least one email/);
    expect(validateMailMessage({ ...valid, cc: "audit@example.com, not-an-email@example" })).toMatch(
      /invalid email address: not-an-email@example/,
    );
  });

  it("validates replyTo as one optional email address", () => {
    expect(validateMailMessage({ ...valid, replyTo: "replies@example.com" })).toBeUndefined();
    expect(validateMailMessage({ ...valid, replyTo: "a@example.com, b@example.com" })).toMatch(
      /replyTo must be a valid email address/,
    );
    expect(validateMailMessage({ ...valid, replyTo: "not-an-email" })).toMatch(
      /replyTo must be a valid email address/,
    );
  });
});
