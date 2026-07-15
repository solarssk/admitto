// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEventMailSettings,
  fetchEventMailSettings,
  saveEventMailSettings,
  sendEventMailTransportTest,
} from "../../src/api/client.js";

describe("event mail settings API client (#511, client.ts had zero direct coverage)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchEventMailSettings GETs the event-scoped mail-settings endpoint", async () => {
    const body = { eventId: "evt 1", organizationId: "org-1", isProduction: true, hasEventOverride: false };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEventMailSettings("evt 1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt%201/mail-settings",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual(body);
  });

  it("fetchEventMailSettings forwards an abort signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEventMailSettings("evt-1", controller.signal);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("saveEventMailSettings PUTs the body to the event-scoped endpoint", async () => {
    const body = { eventId: "evt-1", organizationId: "org-1", isProduction: true, hasEventOverride: true };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveEventMailSettings("evt-1", { provider: "smtp", host: "smtp.example.com" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/mail-settings",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: JSON.stringify({ provider: "smtp", host: "smtp.example.com" }),
      }),
    );
    expect(result).toEqual(body);
  });

  it("clearEventMailSettings DELETEs the event-scoped endpoint", async () => {
    const body = { eventId: "evt-1", organizationId: "org-1", isProduction: true, hasEventOverride: false };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await clearEventMailSettings("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/mail-settings",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
    expect(result).toEqual(body);
  });

  it("sendEventMailTransportTest POSTs the recipient to the event-scoped test endpoint", async () => {
    const body = { status: "sent", provider: "smtp" };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEventMailTransportTest("evt-1", "tester@example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/mail-settings/test",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ to: "tester@example.com" }),
      }),
    );
    expect(result).toEqual(body);
  });

  it("propagates API errors (e.g. 400 incomplete_transport)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: "incomplete_transport", detail: "SMTP host is required." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(saveEventMailSettings("evt-1", { provider: "smtp" })).rejects.toMatchObject({
      status: 400,
    });
  });
});
