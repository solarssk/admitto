// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWalletCleanupJobStatus, triggerEventWideWalletVoidActive } from "../../src/api/client.js";

describe("event-wide wallet void (client) - thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded wallet-void-active endpoint with an empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobId: "job-1" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerEventWideWalletVoidActive("evt with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-void-active",
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
        json: async () => ({ error: "wallet_not_configured" }),
      }),
    );

    await expect(triggerEventWideWalletVoidActive("evt-1")).rejects.toMatchObject({
      status: 409,
      message: "wallet_not_configured",
    });
  });

  it("polls the encoded wallet-cleanup job status route, passing the abort signal through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobId: "job 1", status: "running" }) });
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();

    const result = await fetchWalletCleanupJobStatus("evt-1", "job 1", ac.signal);

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/events/evt-1/wallet-cleanup/jobs/job%201", {
      credentials: "same-origin",
      signal: ac.signal,
    });
    expect(result).toMatchObject({ status: "running" });
  });
});
