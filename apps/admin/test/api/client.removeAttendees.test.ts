// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkRemoveAttendees, removeAttendee } from "../../src/api/client.js";

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

describe("removeAttendee (client)", () => {
  it("POSTs the encoded remove endpoint of the attendee with the reason and returns the counts", async () => {
    const fetchMock = stubFetch({ removed: 1, not_found: 0 });

    const result = await removeAttendee("evt with space", "att/1", "test_person");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%2F1/remove",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ reason: "test_person" }),
      }),
    );
    expect(result).toEqual({ removed: 1, not_found: 0 });
  });

  it("propagates the error code of a JSON body", async () => {
    stubFetch({ error: "forbidden" }, { ok: false, status: 403 });

    await expect(removeAttendee("evt-1", "att-1", "duplicate")).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
    });
  });

  it("falls back to statusText when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(removeAttendee("evt-1", "att-1", "other")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });
});

describe("bulkRemoveAttendees (client)", () => {
  it("POSTs the bulk-remove endpoint with the selected ids and the reason, and returns the counts", async () => {
    const fetchMock = stubFetch({ removed: 2, not_found: 1 });

    const result = await bulkRemoveAttendees("evt with space", ["att-1", "att-2", "att-3"], "wrong_import");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-remove",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2", "att-3"], reason: "wrong_import" }),
      }),
    );
    expect(result).toEqual({ removed: 2, not_found: 1 });
  });

  it("propagates API errors", async () => {
    stubFetch({ code: "event_archived" }, { ok: false, status: 403 });

    await expect(bulkRemoveAttendees("evt-1", ["att-1"], "added_by_mistake")).rejects.toMatchObject({ status: 403 });
  });
});
