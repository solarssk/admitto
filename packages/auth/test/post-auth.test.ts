import { describe, expect, it } from "vitest";
import { isAdminRoleAssignment, resolvePostAuthPath } from "../src/post-auth.js";

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

  it("sends users without roles to account", () => {
    expect(resolvePostAuthPath([])).toBe("/account");
  });

  it("ignores org admin without scope_id", () => {
    expect(
      resolvePostAuthPath([{ role: "admin", scope_type: "organization", scope_id: null }]),
    ).toBe("/account");
  });

  it("ignores mis-scoped superadmin without instance scope", () => {
    expect(
      resolvePostAuthPath([{ role: "superadmin", scope_type: "event", scope_id: "ev-1" }]),
    ).toBe("/account");
  });
});
