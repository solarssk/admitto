// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUserStats } from "../../src/api/client.js";

describe("fetchUserStats (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the instance-wide stats endpoint and returns the parsed body", async () => {
    const stats = { total: 4, active: 4, mfa: 2, sso: 0, active_sessions: 3, active_sessions_users: 2 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => stats,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchUserStats();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/stats",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual(stats);
  });
});
