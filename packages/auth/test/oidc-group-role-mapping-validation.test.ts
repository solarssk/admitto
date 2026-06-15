import { describe, expect, it } from "vitest";
import { validateGroupRoleMappingInput } from "../src/oidc/provider.js";

describe("validateGroupRoleMappingInput", () => {
  it("accepts valid mapping rows", () => {
    expect(() =>
      validateGroupRoleMappingInput({
        group: "admins",
        role: "superadmin",
        scope_type: "instance",
      }),
    ).not.toThrow();
    expect(() =>
      validateGroupRoleMappingInput({
        group: "ops",
        role: "operator",
        scope_type: "event",
        scope_id: "evt_123",
      }),
    ).not.toThrow();
  });

  it("rejects unknown role", () => {
    expect(() =>
      validateGroupRoleMappingInput({
        group: "admins",
        role: "SuperAdmin",
        scope_type: "instance",
      }),
    ).toThrow(/Invalid role/);
  });

  it("rejects unknown scope_type", () => {
    expect(() =>
      validateGroupRoleMappingInput({
        group: "admins",
        role: "admin",
        scope_type: "org",
        scope_id: "org_1",
      }),
    ).toThrow(/Invalid scope_type/);
  });

  it("rejects empty group", () => {
    expect(() =>
      validateGroupRoleMappingInput({
        group: "  ",
        role: "admin",
        scope_type: "organization",
        scope_id: "org_1",
      }),
    ).toThrow(/group is required/);
  });

  it("rejects missing scope_id for org/event", () => {
    expect(() =>
      validateGroupRoleMappingInput({
        group: "ops",
        role: "operator",
        scope_type: "event",
        scope_id: "",
      }),
    ).toThrow(/scope_id is required/);
  });
});
