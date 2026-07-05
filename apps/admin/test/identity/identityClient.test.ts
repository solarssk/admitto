// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createIdentityProvider,
  fetchCfAccessSummary,
  fetchIdentityProvider,
  fetchIdentityProviders,
  toggleIdentityProvider,
  updateIdentityProvider,
} from "../../src/api/client.js";

const fetchMock = vi.spyOn(globalThis, "fetch");

afterEach(() => {
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, init: ResponseInit = { status: 200, statusText: "OK" }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
}

const CF_SUMMARY = {
  enabled: true,
  teamDomain: "team.example.com",
  audience: ["aud-1"],
  protectedPrefixes: ["/admin"],
  locks: { enabled: false, teamDomain: false, audience: false, protectedPrefixes: false },
};

describe("identity API client", () => {
  it("fetchIdentityProviders GETs the providers list and parses it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        providers: [{ id: "p1", display_name: "A", issuer: "https://a", enabled: true }],
      }),
    );
    const data = await fetchIdentityProviders();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/providers",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0]).toMatchObject({ id: "p1", enabled: true });
  });

  it("fetchIdentityProviders forwards the abort signal", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ providers: [] }));
    const controller = new AbortController();
    await fetchIdentityProviders(controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/providers",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("fetchCfAccessSummary GETs the CF Access summary and parses it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(CF_SUMMARY));
    const dto = await fetchCfAccessSummary();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/cf-access",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(dto.teamDomain).toBe("team.example.com");
    expect(dto.locks.enabled).toBe(false);
  });

  it("toggleIdentityProvider POSTs the toggle endpoint with CSRF Origin and returns the new state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "p1", enabled: false }));
    const res = await toggleIdentityProvider("p1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/providers/p1/toggle",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          Origin: window.location.origin,
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(res).toEqual({ id: "p1", enabled: false });
  });

  it("throws ApiError on a non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "validation_failed" }, { status: 400, statusText: "Bad Request" }),
    );
    await expect(fetchIdentityProviders()).rejects.toMatchObject({ name: "ApiError", status: 400 });
  });

  it("fetchIdentityProvider GETs one provider and forwards the abort signal", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "p1",
        provider_type: "oidc",
        display_name: "Google",
        issuer: "https://accounts.google.com",
        client_id: "client-123",
        has_client_secret: true,
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
        claim_email: "email",
        claim_name: "name",
        claim_groups: "groups",
        enabled: true,
        login_button_label: "Continue with Google",
        mappings: [{ group: "admins", role: "admin", scope_type: "instance", scope_id: "" }],
      }),
    );
    const controller = new AbortController();
    const dto = await fetchIdentityProvider("p1", controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/providers/p1",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
    expect(dto.id).toBe("p1");
    expect(dto.has_client_secret).toBe(true);
    expect(dto.mappings).toHaveLength(1);
  });

  it("createIdentityProvider POSTs the body with CSRF Origin and returns the saved provider", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "p1",
        provider_type: "oidc",
        display_name: "Google",
        issuer: "https://accounts.google.com",
        client_id: "client-123",
        has_client_secret: true,
        authorization_endpoint: "",
        token_endpoint: "",
        jwks_uri: "",
        userinfo_endpoint: "",
        claim_email: "",
        claim_name: "",
        claim_groups: "",
        enabled: false,
        login_button_label: null,
        mappings: [],
      }),
    );
    const body = {
      display_name: "Google",
      issuer: "https://accounts.google.com",
      client_id: "client-123",
      client_secret: "secret-abc",
      mappings: [],
    };
    const dto = await createIdentityProvider(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/providers",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          Origin: window.location.origin,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(body),
      }),
    );
    expect(dto.id).toBe("p1");
  });

  it("updateIdentityProvider PUTs the full form with CSRF Origin", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "p1",
        provider_type: "oidc",
        display_name: "Google SSO",
        issuer: "https://accounts.google.com",
        client_id: "client-123",
        has_client_secret: true,
        authorization_endpoint: "",
        token_endpoint: "",
        jwks_uri: "",
        userinfo_endpoint: "",
        claim_email: "",
        claim_name: "",
        claim_groups: "",
        enabled: true,
        login_button_label: null,
        mappings: [],
      }),
    );
    const body = {
      display_name: "Google SSO",
      issuer: "https://accounts.google.com",
      client_id: "client-123",
      enabled: true,
      mappings: [],
    };
    await updateIdentityProvider("p1", body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/identity/providers/p1",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        headers: expect.objectContaining({
          Origin: window.location.origin,
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(body),
      }),
    );
  });
});
