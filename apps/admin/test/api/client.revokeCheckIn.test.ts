// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revokeAttendeeCheckIn } from "../../src/api/client.js";

describe("revokeAttendeeCheckIn (#449, wide review — client.ts had zero direct coverage)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the revoke-checkin endpoint with the encoded event/attendee ids", async () => {
    const card = { id: "att-1", check_in_status: "not_admitted" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ card }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await revokeAttendeeCheckIn("evt with space", "att/1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%2F1/revoke-checkin",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(result).toEqual({ card });
  });

  it("propagates API errors (e.g. 409 not currently admitted)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "Attendee is not currently admitted" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeAttendeeCheckIn("evt-1", "att-1")).rejects.toMatchObject({ status: 409 });
  });
});
