// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkChangeTicketType } from "../../src/api/client.js";

describe("bulkChangeTicketType (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded bulk-ticket-type endpoint with the selected ids and type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updatedCount: 2, alreadySetCount: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkChangeTicketType("evt with space", ["att-1", "att-2", "att-3"], "vip");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-ticket-type",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2", "att-3"], ticket_type: "vip" }),
      }),
    );
    expect(result).toEqual({ updatedCount: 2, alreadySetCount: 1 });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "unknown_ticket_type" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(bulkChangeTicketType("evt-1", ["att-1"], "platinum")).rejects.toMatchObject({
      status: 400,
      message: "unknown_ticket_type",
    });
  });
});
