// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkEraseAttendees, eraseAttendee, fetchEventAttendees } from "../../src/api/client.js";

const RESULT = { erased: 1, already_erased: 0, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] };

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: "",
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("eraseAttendee (client)", () => {
  it("POSTs the encoded erase endpoint of the attendee and returns the counts", async () => {
    const fetchMock = stubFetch({ ...RESULT, wallet_pending: 1, wallet_removed_ids: [] });

    const result = await eraseAttendee("evt with space", "att/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%2F1/erase",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(result).toEqual({ ...RESULT, wallet_pending: 1, wallet_removed_ids: [] });
  });

  it("propagates API errors", async () => {
    stubFetch({ error: "forbidden" }, { ok: false, status: 403 });

    await expect(eraseAttendee("evt-1", "att-1")).rejects.toMatchObject({ status: 403, message: "forbidden" });
  });
});

describe("bulkEraseAttendees (client)", () => {
  it("POSTs the bulk-erase endpoint with the selected ids and returns the counts", async () => {
    const fetchMock = stubFetch({ erased: 2, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });

    const result = await bulkEraseAttendees("evt with space", ["att-1", "att-2", "att-3"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-erase",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2", "att-3"] }),
      }),
    );
    expect(result).toEqual({ erased: 2, already_erased: 1, not_found: 0, wallet_pending: 0, wallet_removed_ids: [] });
  });

  it("propagates API errors", async () => {
    stubFetch({ error: "validation_failed" }, { ok: false, status: 400 });

    await expect(bulkEraseAttendees("evt-1", ["att-1"])).rejects.toMatchObject({
      status: 400,
      message: "validation_failed",
    });
  });
});

describe("fetchEventAttendees (client): erased entries", () => {
  const LIST = { items: [], total: 0, erased_count: 0, page: 1, pageSize: 25 };

  it("asks for the erased entries only when told to", async () => {
    const fetchMock = stubFetch(LIST);

    await fetchEventAttendees("evt-1", { includeErased: true });
    await fetchEventAttendees("evt-1", { includeErased: false });
    await fetchEventAttendees("evt-1");

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toEqual([
      "/api/admin/events/evt-1/attendees?include_erased=1",
      "/api/admin/events/evt-1/attendees",
      "/api/admin/events/evt-1/attendees",
    ]);
  });
});
