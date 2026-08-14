// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWalletMessageJob } from "../../src/api/client.js";

describe("fetchWalletMessageJob (client) — thin wrapper coverage", () => {
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
        sent: null,
        skipped: null,
        errored: null,
        created_at: "2026-08-14T10:00:00.000Z",
        started_at: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();

    const result = await fetchWalletMessageJob("evt with space", "job/1", ac.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-message/jobs/job%2F1",
      { credentials: "same-origin", signal: ac.signal },
    );
    expect(result).toEqual({
      jobId: "job-1",
      status: "running",
      error: null,
      progressTotal: 5,
      progressDone: 2,
      sent: null,
      skipped: null,
      errored: null,
      created_at: "2026-08-14T10:00:00.000Z",
      started_at: null,
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

    await expect(fetchWalletMessageJob("evt-1", "job-1")).rejects.toMatchObject({
      status: 404,
      message: "not_found",
    });
  });
});
