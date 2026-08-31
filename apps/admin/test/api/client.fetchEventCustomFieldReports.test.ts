// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchEventCustomFieldReports } from "../../src/api/client.js";
import type { EventCustomFieldReportsResponse } from "../../src/api/types.js";

const sample: EventCustomFieldReportsResponse = {
  total_attendees: 4,
  fields: [
    {
      id: "cf-1",
      source_field: "shirt_size",
      label: "Shirt size",
      description: null,
      type: "select",
      distribution: [{ key: "M", label: "M", count: 2, pct: 50 }],
      response_rate: null,
    },
  ],
};

describe("fetchEventCustomFieldReports (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the event's custom field report with credentials and an optional signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const result = await fetchEventCustomFieldReports("evt-1", controller.signal);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/reports/custom-fields",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
    expect(result).toEqual(sample);
  });

  it("URL-encodes the event id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => sample });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEventCustomFieldReports("evt with spaces");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20spaces/reports/custom-fields",
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

    await expect(fetchEventCustomFieldReports("evt-1")).rejects.toBeInstanceOf(ApiError);
  });
});
