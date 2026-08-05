// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAdminUser } from "../../src/api/client.js";

describe("deleteAdminUser (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a DELETE to the user's own endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteAdminUser("usr-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users/usr-1",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });
});
