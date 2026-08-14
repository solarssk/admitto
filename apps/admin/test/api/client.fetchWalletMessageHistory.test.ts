// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWalletMessageHistory } from "../../src/api/client.js";

describe("fetchWalletMessageHistory (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the encoded wallet-message history endpoint and returns items", async () => {
    const items = [
      {
        id: "job-1",
        created_at: "2026-06-07T10:00:00.000Z",
        sent: 3,
        skipped: 1,
        errored: 0,
        status: "succeeded" as const,
        error: null,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWalletMessageHistory("evt with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-message/history",
      expect.objectContaining({ credentials: "same-origin", signal: undefined }),
    );
    expect(result).toEqual({ items });
  });

  it("forwards the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchWalletMessageHistory("evt-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/wallet-message/history",
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

    await expect(fetchWalletMessageHistory("evt-1")).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
    });
  });
});
