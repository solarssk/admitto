import { describe, expect, it } from "vitest";
import { isAdminRoleAssignment, resolvePostAuthPath } from "../src/post-auth.js";
import { sanitizeBrandingThemeForTests } from "../src/settings/branding.js";

describe("isAdminRoleAssignment", () => {
  it("accepts instance superadmin and scoped org admin", () => {
    expect(
      isAdminRoleAssignment({ role: "superadmin", scope_type: "instance", scope_id: null }),
    ).toBe(true);
    expect(
      isAdminRoleAssignment({ role: "admin", scope_type: "organization", scope_id: "org-1" }),
    ).toBe(true);
  });

  it("rejects mis-scoped superadmin and org admin without scope_id", () => {
    expect(
      isAdminRoleAssignment({ role: "superadmin", scope_type: "event", scope_id: "ev-1" }),
    ).toBe(false);
    expect(
      isAdminRoleAssignment({ role: "admin", scope_type: "organization", scope_id: null }),
    ).toBe(false);
  });
});

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

  it("sends users without roles to login", () => {
    expect(resolvePostAuthPath([])).toBe("/login");
  });

  it("ignores org admin without scope_id", () => {
    expect(
      resolvePostAuthPath([{ role: "admin", scope_type: "organization", scope_id: null }]),
    ).toBe("/login");
  });

  it("ignores mis-scoped superadmin without instance scope", () => {
    expect(
      resolvePostAuthPath([{ role: "superadmin", scope_type: "event", scope_id: "ev-1" }]),
    ).toBe("/login");
  });
});

describe("sanitizeBrandingTheme", () => {
  it("rejects invalid primary", () => {
    expect(sanitizeBrandingThemeForTests({ primary: "red" }).primary).toBeUndefined();
  });

  it("accepts valid primary", () => {
    expect(sanitizeBrandingThemeForTests({ primary: "#066fd1" }).primary).toBe("#066fd1");
  });

  it("rejects non-https font URL", () => {
    expect(
      sanitizeBrandingThemeForTests({ font_family_url: "http://evil.example/font.woff2" })
        .font_family_url,
    ).toBeUndefined();
  });

  it("truncates long font URL", () => {
    const longUrl = `https://fonts.example/${"a".repeat(2100)}.woff2`;
    const result = sanitizeBrandingThemeForTests({ font_family_url: longUrl });
    expect(result.font_family_url?.length).toBe(2048);
  });

  it("truncates long font name", () => {
    const result = sanitizeBrandingThemeForTests({ font_family_name: "X".repeat(200) });
    expect(result.font_family_name?.length).toBe(128);
  });
});
