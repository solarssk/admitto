// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkRevokeItems } from "../../src/api/client.js";

describe("bulkRevokeItems (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded bulk-revoke-items endpoint with the selected ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revokedCount: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkRevokeItems("evt with space", ["att-1", "att-2", "att-3"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-revoke-items",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2", "att-3"] }),
      }),
    );
    expect(result).toEqual({ revokedCount: 3 });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "insufficient_role" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(bulkRevokeItems("evt-1", ["att-1"])).rejects.toMatchObject({
      status: 403,
      message: "insufficient_role",
    });
  });
});
