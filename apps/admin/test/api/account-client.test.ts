// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelMfaEnroll, patchAccountProfile } from "../../src/api/client.js";

describe("account API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patchAccountProfile PATCHes the profile endpoint and returns the updated fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        display_name: "New Name",
        preferred_locale: "en-GB",
        preferred_time_format: "24h",
        phone_country_code: "+48",
        phone_number: "600123456",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await patchAccountProfile({
      display_name: "New Name",
      phone_country_code: "+48",
      phone_number: "600123456",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/profile",
      expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
    );
    expect(result).toEqual({
      display_name: "New Name",
      preferred_locale: "en-GB",
      preferred_time_format: "24h",
      phone_country_code: "+48",
      phone_number: "600123456",
    });
  });

  it("cancelMfaEnroll DELETEs the pending TOTP enrollment endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await cancelMfaEnroll();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/mfa/totp/enroll",
      expect.objectContaining({
        method: "DELETE",
        credentials: "same-origin",
      }),
    );
  });

  it("cancelMfaEnroll propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "no_pending_enrollment" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelMfaEnroll()).rejects.toMatchObject({ status: 409 });
  });
});
