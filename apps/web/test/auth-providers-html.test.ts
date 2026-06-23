import { describe, expect, it } from "vitest";
import {
  parseMappingsFromForm,
  parseProviderInput,
  renderProviderForm,
} from "../src/admin/auth-providers-html.js";

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

  it("skips rows with empty scope_type", () => {
    const mappings = parseMappingsFromForm({
      mapping_group_0: "admins",
      mapping_role_0: "god",
      mapping_scope_type_0: "",
    });
    expect(mappings).toHaveLength(0);
  });

  it("does not validate role names in parseMappingsFromForm", () => {
    const mappings = parseMappingsFromForm({
      mapping_group_0: "admins",
      mapping_role_0: "god",
      mapping_scope_type_0: "instance",
      mapping_scope_id_0: "",
    });
    expect(mappings).toEqual([
      { group: "admins", role: "god", scope_type: "instance", scope_id: null },
    ]);
  });

  it("defaults new mapping role select to operator", () => {
    const html = renderProviderForm({
      isNew: true,
      mappings: [],
    });
    expect(html).toContain('name="mapping_role_new"');
    expect(html).toMatch(/name="mapping_role_new"[\s\S]*?value="operator" selected/);
  });

  it("invalid legacy role requires explicit replacement select", () => {
    const html = renderProviderForm({
      isNew: false,
      provider: {
        id: "p1",
        provider_type: "oidc",
        display_name: "Test",
        issuer: "https://idp.example.com",
        client_id: "client",
        has_client_secret: false,
        enabled: true,
        authorization_endpoint: "",
        token_endpoint: "",
        jwks_uri: "",
        userinfo_endpoint: "",
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        login_button_label: null,
      },
      mappings: [{ group: "legacy", role: "god", scope_type: "instance", scope_id: "" }],
    });
    expect(html).toContain("Invalid role");
    expect(html).toContain('value="" selected disabled');
    expect(html).not.toContain('value="superadmin" selected');
  });
});

describe("admin pageShell headings", () => {
  it("prefixes document title but not visible h1 on provider form", () => {
    const html = renderProviderForm({ isNew: true, mappings: [] });
    expect(html).toContain("<title>Admitto — Add identity provider</title>");
    expect(html).toContain("<h1>Add identity provider</h1>");
    expect(html).not.toMatch(/<h1>Admitto —/);
  });
});

describe("OIDC provider form — SSO button label", () => {
  it("renders editable SSO button text on create and edit forms", () => {
    const createHtml = renderProviderForm({ isNew: true, mappings: [] });
    expect(createHtml).toContain('name="login_button_label"');
    expect(createHtml).toContain("Sign-in page (/login)");
    expect(createHtml).toContain('placeholder="Continue with SSO"');

    const editHtml = renderProviderForm({
      isNew: false,
      provider: {
        id: "p1",
        provider_type: "oidc",
        display_name: "Microsoft Entra",
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        client_id: "client",
        has_client_secret: true,
        enabled: true,
        authorization_endpoint: "",
        token_endpoint: "",
        jwks_uri: "",
        userinfo_endpoint: "",
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        login_button_label: "Continue with Microsoft SSO",
      },
      mappings: [],
    });
    expect(editHtml).toContain('value="Continue with Microsoft SSO"');
  });

  it("parseProviderInput includes login_button_label", () => {
    expect(
      parseProviderInput({
        display_name: "Google",
        login_button_label: "  Sign in with Google  ",
        issuer: "https://accounts.google.com",
        client_id: "x",
      }).login_button_label,
    ).toBe("Sign in with Google");
  });
});
