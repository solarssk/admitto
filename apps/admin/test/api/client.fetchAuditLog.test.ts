// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuditLog } from "../../src/api/client.js";

describe("fetchAuditLog (client) — query string building", () => {
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

    await fetchAuditLog({});

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/audit-log",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes actionType/start/end when given", async () => {
    const fetchMock = stubFetch();

    await fetchAuditLog({ actionType: "login", start: "2026-01-01", end: "2026-01-31" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/audit-log?action_type=login&start=2026-01-01&end=2026-01-31");
  });
});
