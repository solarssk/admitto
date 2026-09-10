// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "../../src/components/NotificationBell.js";
import type { NotificationDto } from "../../src/api/types.js";
import { renderWithToast } from "../test-utils.js";

const fetchAccountNotifications = vi.fn();
const fetchAccountNotificationsUnreadCount = vi.fn();
const markAccountNotificationRead = vi.fn();
const markAllAccountNotificationsRead = vi.fn();

vi.mock("../../src/api/client.js", () => ({
  fetchAccountNotifications: (...args: unknown[]) => fetchAccountNotifications(...args),
  fetchAccountNotificationsUnreadCount: (...args: unknown[]) => fetchAccountNotificationsUnreadCount(...args),
  markAccountNotificationRead: (...args: unknown[]) => markAccountNotificationRead(...args),
  markAllAccountNotificationsRead: (...args: unknown[]) => markAllAccountNotificationsRead(...args),
}));

function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: "notif-1",
    organization_name: "Demo Org",
    notification_type: "auth.login.repeated_failures",
    severity: "error",
    title: "5 consecutive failed sign-in attempts",
    body: "5 consecutive failed sign-in attempts on admin@example.com.",
    created_at: "2026-09-10T10:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

function openBell() {
  fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("NotificationBell trigger", () => {
  it("stays visible with no badge when there are zero unread notifications", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("shows the unread count on the badge", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 3 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Notifications, 3 unread" })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("caps a large unread count at 99+", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 150 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});

    expect(screen.getByText("99+")).toBeTruthy();
  });
});

describe("NotificationBell dropdown", () => {
  it("fetches the list only once per open, not on every render", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });
    fetchAccountNotifications.mockResolvedValue({ notifications: [], unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});

    openBell();
    await waitFor(() => expect(fetchAccountNotifications).toHaveBeenCalledTimes(1));
  });

  it("shows an empty state when there are no notifications at all", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });
    fetchAccountNotifications.mockResolvedValue({ notifications: [], unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();

    await screen.findByText("You’re all caught up.");
  });

  it("lists notifications with their organization name and severity", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();

    await screen.findByText("5 consecutive failed sign-in attempts");
    expect(screen.getByText(/Demo Org/)).toBeTruthy();
  });

  it("marks an unread notification read on click and decrements the badge", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    markAccountNotificationRead.mockResolvedValue({ unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));

    expect(markAccountNotificationRead).toHaveBeenCalledWith("notif-1");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    });
  });

  it("does not re-mark an already-read notification on click", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification({ read_at: "2026-09-10T11:00:00.000Z" })],
      unread_count: 0,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));

    expect(markAccountNotificationRead).not.toHaveBeenCalled();
  });

  it("marks every unread notification read via 'Mark all as read'", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 2 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [
        makeNotification({ id: "notif-1" }),
        makeNotification({ id: "notif-2", title: "MFA break-glass used" }),
      ],
      unread_count: 2,
    });
    markAllAccountNotificationsRead.mockResolvedValue({ updated_count: 2, unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("MFA break-glass used");

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(markAllAccountNotificationsRead).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
    });
  });
});

describe("NotificationBell polling", () => {
  it("keeps the last-known unread count when a background poll tick fails", async () => {
    vi.useFakeTimers();
    fetchAccountNotificationsUnreadCount.mockResolvedValueOnce({ unread_count: 2 });
    fetchAccountNotificationsUnreadCount.mockRejectedValueOnce(new Error("transient network error"));

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchAccountNotificationsUnreadCount).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
  });

  it("re-polls the unread count automatically ~30s after the initial load", async () => {
    vi.useFakeTimers();
    fetchAccountNotificationsUnreadCount.mockResolvedValueOnce({ unread_count: 1 });
    fetchAccountNotificationsUnreadCount.mockResolvedValueOnce({ unread_count: 4 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();
  });

  it("stops polling once unmounted", async () => {
    vi.useFakeTimers();
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });

    const { unmount } = renderWithToast(<NotificationBell />);
    await act(async () => {});
    expect(fetchAccountNotificationsUnreadCount).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchAccountNotificationsUnreadCount).toHaveBeenCalledTimes(1);
  });
});
