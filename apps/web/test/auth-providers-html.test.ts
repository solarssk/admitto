import { describe, expect, it } from "vitest";
import {
  incompleteMappingRowsWarning,
  parseMappingRowsFromForm,
  parseMappingsFromForm,
  parseProviderInput,
  providerFormViewFromSubmitted,
  renderProviderForm,
} from "../src/admin/auth-providers-html.js";

describe("parseMappingsFromForm", () => {
  it("parses indexed mapping rows from select fields", () => {
    const mappings = parseMappingsFromForm({
      mapping_group_0: "admins",
      mapping_role_0: "superadmin",
      mapping_scope_type_0: "instance",
      mapping_scope_id_0: "",
      mapping_group_1: "ops",
      mapping_role_1: "operator",
      mapping_scope_type_1: "event",
      mapping_scope_id_1: "evt-1",
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

  it("parseMappingRowsFromForm keeps incomplete draft rows", () => {
    expect(
      parseMappingRowsFromForm({
        mapping_group_0: "draft-only",
        mapping_role_0: "",
        mapping_scope_type_0: "",
        mapping_scope_id_0: "",
      }),
    ).toEqual([{ group: "draft-only", role: "operator", scope_type: "instance", scope_id: "" }]);
  });

  it("incompleteMappingRowsWarning describes partial rows", () => {
    expect(
      incompleteMappingRowsWarning({
        mapping_group_0: "admins",
        mapping_role_0: "",
        mapping_scope_type_0: "",
      }),
    ).toContain("incomplete");
  });

  it("providerFormViewFromSubmitted preserves submitted OIDC fields", () => {
    const view = providerFormViewFromSubmitted({
      display_name: "Entra",
      issuer: "https://login.example.com",
      client_id: "abc",
      login_button_label: "Sign in with Entra",
      enabled: "1",
    });
    expect(view.display_name).toBe("Entra");
    expect(view.login_button_label).toBe("Sign in with Entra");
    expect(view.enabled).toBe(true);
  });

  it("renders add/remove mapping controls", () => {
    const html = renderProviderForm({
      isNew: true,
      mappings: [],
    });
    expect(html).toContain('id="mapping-add-btn"');
    expect(html).toContain("Add mapping");
    expect(html).toContain('data-mapping-remove');
    expect(html).not.toContain('name="mapping_scope_type_0"');
    expect(html).not.toContain('name="mapping_group_new"');
  });

  it("renders scope type as select on existing rows", () => {
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
      mappings: [{ group: "admins", role: "admin", scope_type: "organization", scope_id: "org-1" }],
    });
    expect(html).toContain('name="mapping_scope_type_0"');
    expect(html).toContain('value="organization" selected');
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

describe("OIDC provider form — URL fields", () => {
  it("uses type=url for issuer and OIDC endpoint inputs", () => {
    const html = renderProviderForm({ isNew: true, mappings: [] });
    expect(html).toContain('type="url" name="issuer"');
    expect(html).toContain('type="url" name="authorization_endpoint"');
    expect(html).toContain('type="url" name="token_endpoint"');
    expect(html).toContain('type="url" name="jwks_uri"');
    expect(html).toContain('type="url" name="userinfo_endpoint"');
  });
});

describe("OIDC provider form — SSO button label", () => {
  it("renders editable SSO button text and live preview on create and edit forms", () => {
    const createHtml = renderProviderForm({ isNew: true, mappings: [] });
    expect(createHtml).toContain('name="login_button_label"');
    expect(createHtml).toContain("Sign-in page (/login)");
    expect(createHtml).toContain('placeholder="Continue with SSO"');
    expect(createHtml).toContain('id="sso-button-preview-label"');
    expect(createHtml).toContain("Preview on /login");

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
    expect(editHtml).toContain("Continue with Microsoft SSO</span>");
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
