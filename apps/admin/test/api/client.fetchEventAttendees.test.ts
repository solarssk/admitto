// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEventAttendees } from "../../src/api/client.js";

describe("fetchEventAttendees (client) — query string building", () => {
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

  it("omits sortBy/sortDir when they're the defaults (name asc)", async () => {
    const fetchMock = stubFetch();

    await fetchEventAttendees("evt-1", { sortBy: "name", sortDir: "asc" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("includes sortBy when it isn't 'name', and sortDir when it isn't 'asc'", async () => {
    const fetchMock = stubFetch();

    await fetchEventAttendees("evt-1", { sortBy: "ticket_type", sortDir: "desc" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt-1/attendees?sortBy=ticket_type&sortDir=desc");
  });

  it("includes mail_status when given (#522)", async () => {
    const fetchMock = stubFetch();

    await fetchEventAttendees("evt-1", { mail_status: "failed" });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/events/evt-1/attendees?mail_status=failed");
  });
});
