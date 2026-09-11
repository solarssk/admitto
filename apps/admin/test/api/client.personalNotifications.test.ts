// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAccountNotificationPreferences,
  fetchAccountNotifications,
  fetchAccountNotificationsUnreadCount,
  markAccountNotificationRead,
  markAllAccountNotificationsRead,
  patchAccountNotificationPreference,
} from "../../src/api/client.js";

describe("personal notification client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchAccountNotificationPreferences GETs the preferences endpoint", async () => {
    const body = { notification_types: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAccountNotificationPreferences()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/notifications/preferences",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("fetchAccountNotificationPreferences forwards the given AbortSignal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notification_types: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await fetchAccountNotificationPreferences(controller.signal);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it("patchAccountNotificationPreference PATCHes the given cell and returns the updated grid", async () => {
    const saved = { notification_types: [{ id: "auth.login.repeated_failures", channels: { email: false } }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => saved });
    vi.stubGlobal("fetch", fetchMock);

    const body = { notification_type: "auth.login.repeated_failures", channel: "email" as const, enabled: false };
    await expect(patchAccountNotificationPreference(body)).resolves.toEqual(saved);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/account/notifications/preferences");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify(body) });
  });

  it("fetchAccountNotifications GETs the notifications list endpoint", async () => {
    const body = { notifications: [], unread_count: 0 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAccountNotifications()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/notifications",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("fetchAccountNotificationsUnreadCount GETs the unread-count endpoint", async () => {
    const body = { unread_count: 4 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAccountNotificationsUnreadCount()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/notifications/unread-count",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("markAccountNotificationRead PATCHes the notification's own read endpoint", async () => {
    const body = { unread_count: 2 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(markAccountNotificationRead("notif-1")).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/account/notifications/notif-1/read");
    expect(init).toMatchObject({ method: "PATCH", body: JSON.stringify({}) });
  });

  it("markAccountNotificationRead encodes the id in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unread_count: 0 }) });
    vi.stubGlobal("fetch", fetchMock);

    await markAccountNotificationRead("id with spaces");

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/account/notifications/id%20with%20spaces/read");
  });

  it("markAllAccountNotificationsRead POSTs an empty body", async () => {
    const body = { updated_count: 3, unread_count: 0 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);

    await expect(markAllAccountNotificationsRead()).resolves.toEqual(body);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/account/notifications/mark-all-read");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({}) });
  });
});
