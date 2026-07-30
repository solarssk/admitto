// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSessionDeviceLabel } from "../../src/api/client.js";

describe("updateSessionDeviceLabel (client) — thin wrapper coverage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the trimmed label to the session's device-label endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deviceLabel: "Tablet 1 — main entrance" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateSessionDeviceLabel("session-1", "Tablet 1 — main entrance");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sessions/session-1/device-label",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ deviceLabel: "Tablet 1 — main entrance" }),
      }),
    );
    expect(result).toEqual({ deviceLabel: "Tablet 1 — main entrance" });
  });

  it("sends null to clear a label", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ deviceLabel: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await updateSessionDeviceLabel("session-1", null);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/sessions/session-1/device-label",
      expect.objectContaining({ body: JSON.stringify({ deviceLabel: null }) }),
    );
    expect(result).toEqual({ deviceLabel: null });
  });

  it("propagates API errors (e.g. 409 session no longer editable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ error: "session_not_editable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateSessionDeviceLabel("session-1", "New Label")).rejects.toMatchObject({
      status: 409,
    });
  });
});
