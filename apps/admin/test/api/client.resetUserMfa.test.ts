// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetUserMfa } from "../../src/api/client.js";

describe("resetUserMfa (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an empty body when no actor step-up code is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await resetUserMfa("usr-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/usr-1/reset-2fa",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });

  it("sends the actor's step-up code when resetting another superadmin's MFA", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await resetUserMfa("usr-1", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/usr-1/reset-2fa",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }),
    );
  });
});
