// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImportHistory } from "../../src/api/client.js";

describe("fetchImportHistory (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the encoded import history endpoint and returns items", async () => {
    const items = [
      {
        id: "log-1",
        created_at: "2026-06-07T10:00:00.000Z",
        filename: "attendees.csv",
        created: 1,
        updated: 2,
        skipped: 0,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchImportHistory("evt with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/import/history",
      expect.objectContaining({ credentials: "same-origin", signal: undefined }),
    );
    expect(result).toEqual(items);
  });

  it("forwards the abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchImportHistory("evt-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/import/history",
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

    await expect(fetchImportHistory("evt-1")).rejects.toMatchObject({
      status: 403,
      message: "forbidden",
    });
  });
});
