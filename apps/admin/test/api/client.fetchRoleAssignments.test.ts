// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRoleAssignments } from "../../src/api/client.js";

describe("fetchRoleAssignments (client) — query string building", () => {
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

    await fetchRoleAssignments();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/role-assignments",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes page/pageSize when given", async () => {
    const fetchMock = stubFetch();

    await fetchRoleAssignments({ page: 3, pageSize: 50 });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/role-assignments?page=3&pageSize=50");
  });
});
