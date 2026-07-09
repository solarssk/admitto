// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeItemState } from "../../src/api/client.js";

describe("revokeItemState (item revocation feature)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the item-revoke endpoint with the encoded event/attendee/item ids", async () => {
    const card = { id: "att-1", items: [{ key: "gift_bag", state: "pending", actions: ["issued"] }] };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ card }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await revokeItemState("evt with space", "att/1", "gift bag");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%2F1/items/gift%20bag/revoke",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(result).toEqual({ card });
  });

  it("propagates API errors (e.g. 409 unknown item)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "Item not found or disabled" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeItemState("evt-1", "att-1", "nope")).rejects.toMatchObject({ status: 409 });
  });
});
