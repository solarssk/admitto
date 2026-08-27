// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelBulkSend } from "../../src/api/client.js";

describe("cancelBulkSend (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs cancel to the encoded event/batch endpoint and returns the cancelled count", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ batchId: "batch with space", cancelled: 3 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelBulkSend("evt with space", "batch with space")).resolves.toEqual({
      batchId: "batch with space",
      cancelled: 3,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/send/batch%20with%20space/cancel",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({});
  });
});
