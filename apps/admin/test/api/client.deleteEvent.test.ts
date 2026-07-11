// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEvent } from "../../src/api/client.js";

describe("deleteEvent (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs the encoded event endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteEvent("evt with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });

  it("propagates API errors (e.g. 409 not deletable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "event_not_deletable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteEvent("evt-1")).rejects.toMatchObject({ status: 409 });
  });
});
