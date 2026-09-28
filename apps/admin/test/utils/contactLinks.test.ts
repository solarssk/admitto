import { describe, expect, it } from "vitest";
import { mailtoHref, telHref } from "../../src/utils/contactLinks.js";

describe("telHref", () => {
  it.each([
    ["+48 500 100 200", "tel:+48500100200"],
    ["(555) 010-0199", "tel:5550100199"],
    ["+1.555.010.0199", "tel:+15550100199"],
    ["  4321  ", "tel:4321"],
    // Saved before the form checked it: only the digits (and a leading +) survive.
    ["call 555 0100 ext 5", "tel:55501005"],
    ["48+123", "tel:48123"],
  ])("turns %j into %s", (phone, href) => {
    expect(telHref(phone)).toBe(href);
  });
});

describe("mailtoHref", () => {
  it("keeps an ordinary address readable, with the @ unencoded", () => {
    expect(mailtoHref("jane.doe+events@example.com")).toBe("mailto:jane.doe%2Bevents@example.com");
    expect(mailtoHref("  jane@example.com ")).toBe("mailto:jane@example.com");
  });

  it("keeps a ? or & inside the address instead of letting it start a header", () => {
    const href = mailtoHref("victim@example.com?subject=Hello&body=Send%20your%20password");
    expect(href.startsWith("mailto:victim@example.com%3Fsubject%3DHello%26body%3D")).toBe(true);
    expect(href).not.toContain("?");
    expect(href).not.toContain("&");
  });
});
