// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeUserSessions } from "../../src/api/client.js";

describe("revokeUserSessions (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an empty body when no actor step-up code is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sessionsRevoked: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await revokeUserSessions("usr-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/usr-1/revoke-sessions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });

  it("sends the actor's step-up code when revoking another superadmin's sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sessionsRevoked: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await revokeUserSessions("usr-1", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/usr-1/revoke-sessions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ code: "123456" }) }),
    );
  });
});
