// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWalletPushHistory } from "../../src/api/client.js";

describe("fetchWalletPushHistory (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the encoded wallet-push history endpoint with page/pageSize and returns items + total", async () => {
    const items = [
      {
        id: "job-1",
        created_at: "2026-06-07T10:00:00.000Z",
        reissued: 3,
        skipped: 1,
        errored: 0,
        status: "succeeded" as const,
        error: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items, total: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWalletPushHistory("evt with space", 2, 25);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-push/history?page=2&pageSize=25",
      expect.objectContaining({ credentials: "same-origin", signal: undefined }),
    );
    expect(result).toEqual({ items, total: 1 });
  });

  it("forwards the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchWalletPushHistory("evt-1", 1, 10, controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/wallet-push/history?page=1&pageSize=10",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchWalletPushHistory("evt-1", 1, 10)).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
    });
  });
});
