import { describe, expect, it } from "vitest";
import { isReservedDocumentationEmail } from "../../src/maps/user-agent.js";

describe("isReservedDocumentationEmail", () => {
  it("flags RFC 2606 and special-use domains", () => {
    expect(isReservedDocumentationEmail("ops@example.com")).toBe(true);
    expect(isReservedDocumentationEmail("ops@mail.example.org")).toBe(true);
    expect(isReservedDocumentationEmail("a@example.net")).toBe(true);
    expect(isReservedDocumentationEmail("root@localhost")).toBe(true);
    expect(isReservedDocumentationEmail("dev@foo.test")).toBe(true);
  });

  it("allows ordinary contact addresses", () => {
    expect(isReservedDocumentationEmail("ops@customer.org")).toBe(false);
    expect(isReservedDocumentationEmail("support@admitto.app")).toBe(false);
  });

  it("rejects non-emails", () => {
    expect(isReservedDocumentationEmail("Ops Team")).toBe(false);
    expect(isReservedDocumentationEmail("")).toBe(false);
  });
});
