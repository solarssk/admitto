// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAttendee } from "../../src/api/client.js";

describe("deleteAttendee (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs the encoded attendee endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await deleteAttendee("evt with space", "att with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });

  it("propagates the error message from a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "attendee_not_found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAttendee("evt-1", "att-1")).rejects.toMatchObject({
      status: 404,
      message: "attendee_not_found",
    });
  });

  it("falls back to statusText when the error body isn't JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAttendee("evt-1", "att-1")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });
});
