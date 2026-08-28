// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchEventWalletReports } from "../../src/api/client.js";
import type { EventWalletReportsResponse } from "../../src/api/types.js";

const sample: EventWalletReportsResponse = {
  total_attendees: 4,
  synced_at: null,
  passes_truncated: false,
  adoption: { got_pass: 2, got_pass_pct: 50, confirmed: 1, confirmed_pct: 50, cancelled: 0 },
  platform: { apple_only: 1, google_only: 0, both: 0, not_installed: 1 },
  by_ticket_type: [],
  issued_by_day: [],
  time_to_wallet_tap: { average_days: null, buckets: [] },
  admission_by_wallet: {
    with_wallet: { total: 1, admitted: 1, pct: 100 },
    without_wallet: { total: 3, admitted: 0, pct: 0 },
  },
};

describe("fetchEventWalletReports (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the event's wallet report with credentials and an optional signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await fetchEventWalletReports("evt-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/reports/wallets",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
    expect(result).toEqual(sample);
  });

  it("URL-encodes the event id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEventWalletReports("evt with spaces");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20spaces/reports/wallets",
      expect.anything(),
    );
  });

  it("throws ApiError when the endpoint rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({ error: "forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchEventWalletReports("evt-1")).rejects.toBeInstanceOf(ApiError);
  });
});
