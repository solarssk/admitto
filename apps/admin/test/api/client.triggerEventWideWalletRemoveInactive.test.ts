// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerEventWideWalletRemoveInactive } from "../../src/api/client.js";

describe("event-wide wallet remove-inactive (client) - thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded wallet-remove-inactive endpoint with an empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobId: "job-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerEventWideWalletRemoveInactive("evt with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-remove-inactive",
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({}) }),
    );
    expect(result).toEqual({ jobId: "job-1" });
  });

  it("propagates API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: "Conflict",
        json: async () => ({ error: "wallet_cleanup_already_running" }),
      }),
    );

    await expect(triggerEventWideWalletRemoveInactive("evt-1")).rejects.toMatchObject({
      status: 409,
      message: "wallet_cleanup_already_running",
    });
  });
});
