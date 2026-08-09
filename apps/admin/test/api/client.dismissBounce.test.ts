// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissBounce, resendTicket } from "../../src/api/client.js";

describe("dismissBounce / resendTicket (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs dismiss-bounce to the encoded attendee endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email_bounce_dismissed_at: "2026-09-01T13:00:00.000Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(dismissBounce("evt with space", "att with space")).resolves.toEqual({
      email_bounce_dismissed_at: "2026-09-01T13:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%20with%20space/attendees/att%20with%20space/dismiss-bounce",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("POSTs resend with an optional templateId body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "dlv-2" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await resendTicket("evt-1", "att-1", { templateId: "tpl-reminder" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/attendees/att-1/resend",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ templateId: "tpl-reminder" });
  });
});
