// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventDeliveries } from "../../src/api/client.js";

describe("fetchEventDeliveries (client) — query string building", () => {
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

    await fetchEventDeliveries("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/deliveries",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes page/status/purpose when given", async () => {
    const fetchMock = stubFetch();

    await fetchEventDeliveries("evt-1", { page: 2, status: "failed", purpose: "ticket" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt-1/deliveries?page=2&status=failed&purpose=ticket");
  });
});
