import { describe, expect, it } from "vitest";
import { resolveSafeRedirectPath } from "../src/auth/safe-redirect.js";

describe("resolveSafeRedirectPath", () => {
  it("allows same-origin relative paths", () => {
    expect(resolveSafeRedirectPath("/operator")).toBe("/operator");
    expect(resolveSafeRedirectPath("/events/1")).toBe("/events/1");
  });

  it("rejects open redirects and protocol-relative paths", () => {
    expect(resolveSafeRedirectPath("//evil.com")).toBe("/operator");
    expect(resolveSafeRedirectPath("https://evil.com")).toBe("/operator");
  });

  it("rejects backslash and control-character bypasses", () => {
    expect(resolveSafeRedirectPath("/\\evil.com")).toBe("/operator");
    expect(resolveSafeRedirectPath("/foo\\bar")).toBe("/operator");
    expect(resolveSafeRedirectPath("/ok\r\nLocation: https://evil.com")).toBe("/operator");
  });
});
