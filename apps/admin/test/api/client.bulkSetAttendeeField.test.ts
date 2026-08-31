// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkSetAttendeeField } from "../../src/api/client.js";

describe("bulkSetAttendeeField (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the encoded bulk-set-field endpoint with the selected ids, field, and value", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updatedCount: 2, alreadySetCount: 1, conflictCount: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await bulkSetAttendeeField("evt-1", ["att-1", "att-2"], "company", "Acme");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/bulk-set-field",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ attendeeIds: ["att-1", "att-2"], field: "company", value: "Acme" }),
      }),
    );
    expect(result).toEqual({ updatedCount: 2, alreadySetCount: 1, conflictCount: 0 });
  });

  it("propagates API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "validation_error" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      bulkSetAttendeeField("evt-1", ["att-1"], "department", "Engineering"),
    ).rejects.toMatchObject({
      status: 400,
      message: "validation_error",
    });
  });
});
