// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerEventWideWalletRefreshStatus } from "../../src/api/client.js";

describe("triggerEventWideWalletRefreshStatus (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded wallet-refresh-status endpoint with an empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: "job-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerEventWideWalletRefreshStatus("evt with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-refresh-status",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(result).toEqual({ jobId: "job-1" });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "wallet_not_configured" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(triggerEventWideWalletRefreshStatus("evt-1")).rejects.toMatchObject({
      status: 409,
      message: "wallet_not_configured",
    });
  });
});
