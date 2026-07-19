// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkCheckInAttendees } from "../../src/api/client.js";

describe("bulkCheckInAttendees (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded bulk-checkin endpoint with the selected ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkedIn: 2, alreadyCheckedIn: 1, revoked: 0, invalid: 0, errored: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkCheckInAttendees("evt with space", ["att-1", "att-2", "att-3"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-checkin",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2", "att-3"] }),
      }),
    );
    expect(result).toEqual({ checkedIn: 2, alreadyCheckedIn: 1, revoked: 0, invalid: 0, errored: 0 });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "insufficient_role" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(bulkCheckInAttendees("evt-1", ["att-1"])).rejects.toMatchObject({
      status: 403,
      message: "insufficient_role",
    });
  });
});
