// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchNotificationSettings,
  saveNotificationSettings,
  testNotificationSettings,
} from "../../src/api/client.js";

describe("notification-settings client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchNotificationSettings GETs the settings endpoint", async () => {
    const body = {
      webhook: { set: false, kind: "generic" },
      extra_email_recipients: [],
      disabled_channels: {},
      notification_types: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNotificationSettings()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/notification-settings",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("fetchNotificationSettings forwards the given AbortSignal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchNotificationSettings(controller.signal);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it("saveNotificationSettings PUTs the draft and returns the saved settings", async () => {
    const saved = {
      webhook: { set: true, kind: "discord" },
      extra_email_recipients: [],
      disabled_channels: {},
      notification_types: [],
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);

    const body = { webhookKind: "discord" as const };
    await expect(saveNotificationSettings(body)).resolves.toEqual(saved);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/notification-settings");
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify(body) });
  });

  it("testNotificationSettings POSTs an empty body when no address is given (webhook card's own test)", async () => {
    const result = {
      webhook: { ok: true },
      email: { ok: true, skipped: true },
      in_app: { ok: true },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(testNotificationSettings()).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/admin/notification-settings/test");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({}) });
  });

  it("testNotificationSettings POSTs {testEmail} when an address is given (a recipient row's own test)", async () => {
    const result = { webhook: { ok: true, skipped: true }, email: { ok: true }, in_app: { ok: true, skipped: true } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);

    await expect(testNotificationSettings("ops@example.com")).resolves.toEqual(result);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ testEmail: "ops@example.com" }) });
  });
});
