// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWalletMessageAttendees } from "../../src/api/client.js";

describe("fetchWalletMessageAttendees (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the encoded search endpoint with q/pageSize and forwards the abort signal", async () => {
    const items = [{ id: "att-1", name: "Jane Doe", email: "jane@example.com" }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const ac = new AbortController();

    const result = await fetchWalletMessageAttendees(
      "evt with space",
      { q: "jane doe", pageSize: 20 },
      ac.signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/wallet-message/attendees?q=jane+doe&pageSize=20",
      { credentials: "same-origin", signal: ac.signal },
    );
    expect(result).toEqual({ items });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWalletMessageAttendees("evt-1", { q: "jane", pageSize: 20 }),
    ).rejects.toMatchObject({ status: 403, message: "forbidden" });
  });
});
