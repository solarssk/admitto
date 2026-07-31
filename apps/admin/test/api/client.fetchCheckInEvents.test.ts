// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCheckInEvents } from "../../src/api/client.js";

describe("fetchCheckInEvents (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the plain events list when includeAttendeeCount is not requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchCheckInEvents();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/checkin/events",
      expect.objectContaining({ credentials: "same-origin", signal: undefined }),
    );
  });

  it("appends includeAttendeeCount=true and forwards the signal when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchCheckInEvents({ includeAttendeeCount: true, signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/checkin/events?includeAttendeeCount=true",
      expect.objectContaining({ credentials: "same-origin", signal: controller.signal }),
    );
  });

  it("returns the events array from the response body", async () => {
    const events = [{ id: "evt-1", title: "Spring Summit" }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events }) }),
    );

    await expect(fetchCheckInEvents()).resolves.toEqual(events);
  });
});
