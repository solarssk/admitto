// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addAttendeeNote,
  deleteAttendee,
  deleteAttendeeNote,
  fetchAttendeeDetail,
  updateAttendeeNote,
} from "../../src/api/client.js";

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

  it("sends attendee-note mutations to their encoded endpoints", async () => {
    const detail = { id: "att-1", notes: [] };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    await addAttendeeNote("evt with space", "att with space", "New note");
    await updateAttendeeNote(
      "evt with space",
      "att with space",
      "note with space",
      "Updated note",
    );
    await deleteAttendeeNote(
      "evt with space",
      "att with space",
      "note with space",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space/notes",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space/notes/note%20with%20space",
      expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space/notes/note%20with%20space",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });

  it("requests a later notes page on the attendee detail endpoint", async () => {
    const detail = { id: "att-1", notes: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAttendeeDetail("evt with space", "att with space", undefined, 2);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space?notes_page=2",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("requests the first notes page without a query string by default", async () => {
    const detail = { id: "att-1", notes: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAttendeeDetail("evt with space", "att with space");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
