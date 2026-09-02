// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchEventMailReports } from "../../src/api/client.js";
import type { EventMailReportsResponse } from "../../src/api/types.js";

const sample: EventMailReportsResponse = {
  total_attendees: 4,
  delivery: { total_attempts: 5, successful: 4, successful_pct: 80, by_status: [{ status: "accepted", count: 4 }] },
  attendee_reach: { reached: 3, not_reached: 1, reached_pct: 75 },
  by_purpose: { initial: 4, resend: 1 },
  by_template: [{ template: null, total: 5, successful: 4, successful_pct: 80 }],
  sent_by_day: [],
  ticket_viewed: { reached: 3, viewed: 1, viewed_pct: 33.3 },
};

describe("fetchEventMailReports (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the event's mail report with credentials and an optional signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await fetchEventMailReports("evt-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/reports/mail",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
    expect(result).toEqual(sample);
  });

  it("URL-encodes the event id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEventMailReports("evt with spaces");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20spaces/reports/mail",
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

    await expect(fetchEventMailReports("evt-1")).rejects.toBeInstanceOf(ApiError);
  });
});
