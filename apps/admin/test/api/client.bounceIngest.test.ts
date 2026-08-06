// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchEventBounceIngestSettings,
  probeEventMailSmtpConnection,
  runEventBounceIngestCheck,
  saveEventBounceIngestSettings,
  testEventBounceIngestConnection,
} from "../../src/api/client.js";

describe("bounce ingest API client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchEventBounceIngestSettings GETs the bounce-ingest-settings endpoint", async () => {
    const body = {
      eventId: "evt-1",
      organizationId: "org-1",
      configured: true,
      enabled: true,
      imap_host: "imap.example.com",
      imap_port: 993,
      imap_username: "bounce@example.com",
      imap_password: { set: true, masked: "••••" },
      reuse_smtp_credentials: false,
      smtp_reuse_available: true,
      folders: ["INBOX"],
      poll_interval_minutes: 5,
      lastRun: null,
    recentRuns: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEventBounceIngestSettings("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/bounce-ingest-settings",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(result).toEqual(body);
  });

  it("fetchEventBounceIngestSettings forwards an abort signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEventBounceIngestSettings("evt-1", controller.signal);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("saveEventBounceIngestSettings PUTs the body", async () => {
    const body = { enabled: true, imap_host: "imap.example.com" };
    const response = { eventId: "evt-1", configured: true };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);

    const result = await saveEventBounceIngestSettings("evt-1", body);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/bounce-ingest-settings",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: JSON.stringify(body),
      }),
    );
    expect(result).toEqual(response);
  });

  it("testEventBounceIngestConnection POSTs the test endpoint", async () => {
    const body = { ok: true, message: "Connected. Checked 1 folder." };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await testEventBounceIngestConnection("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/bounce-ingest-settings/test",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(result).toEqual(body);
  });

  it("runEventBounceIngestCheck POSTs the run endpoint", async () => {
    const body = {
      ok: true,
      message: "Check finished. 1 seen, 0 bounced.",
      lastRun: {
        at: "2026-08-06T10:00:00.000Z",
        ok: true,
        messagesSeen: 1,
        bouncesApplied: 0,
        softBouncesLogged: 0,
        unparsed: 0,
        noMatchingDelivery: 0,
        errors: 0,
        connectFailed: false,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runEventBounceIngestCheck("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/bounce-ingest-settings/run",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(result).toEqual(body);
  });

  it("probeEventMailSmtpConnection POSTs the event mail probe endpoint", async () => {
    const body = { ok: true, message: "Connected. SMTP account verified." };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    const result = await probeEventMailSmtpConnection("evt-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/events/evt-1/mail-settings/probe",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({}),
      }),
    );
    expect(result).toEqual(body);
  });

  it("surfaces API errors from saveEventBounceIngestSettings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "validation_failed", detail: "IMAP host is required when enabled" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveEventBounceIngestSettings("evt-1", { enabled: true }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
