// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelMfaEnroll } from "../../src/api/client.js";

describe("account API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
