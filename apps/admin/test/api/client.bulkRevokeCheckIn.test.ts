// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkRevokeCheckIn } from "../../src/api/client.js";

describe("bulkRevokeCheckIn (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded bulk-revoke-checkin endpoint with the selected ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: 2, notAdmitted: 1, blocked: 0, errored: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkRevokeCheckIn("evt with space", ["att-1", "att-2", "att-3"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-revoke-checkin",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2", "att-3"] }),
      }),
    );
    expect(result).toEqual({ revoked: 2, notAdmitted: 1, blocked: 0, errored: 0 });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "insufficient_role" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(bulkRevokeCheckIn("evt-1", ["att-1"])).rejects.toMatchObject({
      status: 403,
      message: "insufficient_role",
    });
  });
});
