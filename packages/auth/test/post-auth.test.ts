import { describe, expect, it } from "vitest";
import { resolvePostAuthPath } from "../src/post-auth.js";
import { sanitizeBrandingThemeForTests } from "../src/settings/branding.js";

describe("resolvePostAuthPath", () => {
  it("sends superadmin to /admin", () => {
    expect(
      resolvePostAuthPath([{ role: "superadmin", scope_type: "instance", scope_id: null }]),
    ).toBe("/admin");
  });

  it("sends org admin to /admin", () => {
    expect(
      resolvePostAuthPath([{ role: "admin", scope_type: "organization", scope_id: "org-1" }]),
    ).toBe("/admin");
  });

  it("sends operator-only to /operator", () => {
    expect(
      resolvePostAuthPath([{ role: "operator", scope_type: "event", scope_id: "ev-1" }]),
    ).toBe("/operator");
  });

  it("prefers admin when mixed admin + operator", () => {
    expect(
      resolvePostAuthPath([
        { role: "admin", scope_type: "organization", scope_id: "org-1" },
        { role: "operator", scope_type: "event", scope_id: "ev-1" },
      ]),
    ).toBe("/admin");
  });
});

describe("sanitizeBrandingTheme", () => {
  it("rejects invalid primary", () => {
    expect(sanitizeBrandingThemeForTests({ primary: "red" }).primary).toBeUndefined();
  });

  it("accepts valid primary", () => {
    expect(sanitizeBrandingThemeForTests({ primary: "#066fd1" }).primary).toBe("#066fd1");
  });
});
