// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminUsers } from "../../src/api/client.js";

describe("fetchAdminUsers (client) — query string building", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("omits the query string when no params are given", async () => {
    const fetchMock = stubFetch();

    await fetchAdminUsers();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes organizationId/role/status when given", async () => {
    const fetchMock = stubFetch();

    await fetchAdminUsers({ organizationId: "org-1", role: "admin", status: "active" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/users?organizationId=org-1&role=admin&status=active");
  });
});
