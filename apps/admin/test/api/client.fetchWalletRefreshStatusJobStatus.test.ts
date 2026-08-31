// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWalletRefreshStatusJobStatus } from "../../src/api/client.js";

describe("fetchWalletRefreshStatusJobStatus (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the encoded job-status endpoint and forwards the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        jobId: "job-1",
        status: "running",
        error: null,
        progressTotal: 5,
        progressDone: 2,
        refreshed: null,
        skipped: null,
        errored: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();

    const result = await fetchWalletRefreshStatusJobStatus("evt with space", "job/1", ac.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-refresh-status/jobs/job%2F1",
      { credentials: "same-origin", signal: ac.signal },
    );
    expect(result).toEqual({
      jobId: "job-1",
      status: "running",
      error: null,
      progressTotal: 5,
      progressDone: 2,
      refreshed: null,
      skipped: null,
      errored: null,
    });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "not_found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWalletRefreshStatusJobStatus("evt-1", "job-1")).rejects.toMatchObject({
      status: 404,
      message: "not_found",
    });
  });
});
