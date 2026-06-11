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

  it("rejects CRLF in subject", () => {
    expect(validateMailMessage({ ...valid, subject: "Hi\r\nBcc: evil@example.com" })).toMatch(/subject/);
  });

  it("accepts RFC5322 cc and validates each address", () => {
    expect(
      validateMailMessage({
        ...valid,
        cc: '"Audit, Team" <audit@example.com>, ops@example.com',
      }),
    ).toBeUndefined();
  });
});
