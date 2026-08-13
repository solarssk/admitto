// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkDeleteWalletPass, bulkReissueWalletPass, bulkVoidWalletPass } from "../../src/api/client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bulkVoidWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded bulk-wallet-void endpoint with the selected ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ voided: 2, skipped: 1, errored: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkVoidWalletPass("evt with space", ["att-1", "att-2"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/bulk-wallet-void",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2"] }),
      }),
    );
    expect(result).toEqual({ voided: 2, skipped: 1, errored: 0 });
  });
});

describe("bulkReissueWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded bulk-wallet-reissue endpoint with the selected ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reissued: 2, skipped: 1, errored: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkReissueWalletPass("evt-1", ["att-1", "att-2"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/bulk-wallet-reissue",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2"] }),
      }),
    );
    expect(result).toEqual({ reissued: 2, skipped: 1, errored: 0 });
  });
});

describe("bulkDeleteWalletPass (client) — thin wrapper coverage", () => {
  it("POSTs the encoded bulk-wallet-delete endpoint with the selected ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deleted: 2, skipped: 1, errored: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkDeleteWalletPass("evt-1", ["att-1", "att-2"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/bulk-wallet-delete",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2"] }),
      }),
    );
    expect(result).toEqual({ deleted: 2, skipped: 1, errored: 0 });
  });
});
