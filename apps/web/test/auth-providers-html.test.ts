import { describe, expect, it } from "vitest";
import { parseMappingsFromForm } from "../src/admin/auth-providers-html.js";

describe("parseMappingsFromForm", () => {
  it("parses role values from select fields", () => {
    const mappings = parseMappingsFromForm({
      mapping_group_0: "admins",
      mapping_role_0: "superadmin",
      mapping_scope_type_0: "instance",
      mapping_scope_id_0: "",
      mapping_group_new: "ops",
      mapping_role_new: "operator",
      mapping_scope_type_new: "event",
      mapping_scope_id_new: "evt-1",
    });
    expect(mappings).toEqual([
      { group: "admins", role: "superadmin", scope_type: "instance", scope_id: null },
      { group: "ops", role: "operator", scope_type: "event", scope_id: "evt-1" },
    ]);
  });

  it("skips incomplete mapping rows", () => {
    const mappings = parseMappingsFromForm({
      mapping_group_0: "admins",
      mapping_role_0: "god",
      mapping_scope_type_0: "",
    });
    expect(mappings).toHaveLength(0);
  });
});
