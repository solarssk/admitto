// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchCfAccessSummary,
  fetchIdentityProviders,
  toggleIdentityProvider,
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
});
