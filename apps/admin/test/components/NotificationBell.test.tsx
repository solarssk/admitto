// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell, resetNotificationBellCache } from "../../src/components/NotificationBell.js";
import type { NotificationDto } from "../../src/api/types.js";
import { renderWithToast } from "../test-utils.js";

const fetchAccountNotifications = vi.fn();
const fetchAccountNotificationsUnreadCount = vi.fn();
const markAccountNotificationRead = vi.fn();
const markAllAccountNotificationsRead = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAccountNotifications: (...args: unknown[]) => fetchAccountNotifications(...args),
    fetchAccountNotificationsUnreadCount: (...args: unknown[]) => fetchAccountNotificationsUnreadCount(...args),
    markAccountNotificationRead: (...args: unknown[]) => markAccountNotificationRead(...args),
    markAllAccountNotificationsRead: (...args: unknown[]) => markAllAccountNotificationsRead(...args),
  };
});

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
  resetNotificationBellCache();
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

  it("keeps showing the last-known count across a remount instead of flashing back to 0", async () => {
    // StaffShell (this component's parent) is mounted separately by each top-level shell
    // (EventsListShell/AdminShell/OperatorShell/InstanceSettingsShell), so NotificationBell
    // genuinely remounts on every switch between them - the bug this cache fixes (PO report).
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 5 });

    const { unmount } = renderWithToast(<NotificationBell />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Notifications, 5 unread" })).toBeTruthy();
    unmount();

    fetchAccountNotificationsUnreadCount.mockClear();
    renderWithToast(<NotificationBell />);

    expect(screen.getByRole("button", { name: "Notifications, 5 unread" })).toBeTruthy();
    expect(fetchAccountNotificationsUnreadCount).not.toHaveBeenCalled();
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

    expect(await screen.findByText("You’re all caught up.")).toBeTruthy();
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

  it("carries the decremented count into a later remount, not the stale pre-read value", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    markAccountNotificationRead.mockResolvedValue({ unread_count: 0 });

    const { unmount } = renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");
    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    unmount();

    fetchAccountNotificationsUnreadCount.mockClear();
    renderWithToast(<NotificationBell />);

    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(fetchAccountNotificationsUnreadCount).not.toHaveBeenCalled();
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

  it("shows a retry action when the list fails to load, and retrying loads it", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });
    fetchAccountNotifications.mockRejectedValueOnce(new Error("boom"));

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    expect(await screen.findByText("Could not load notifications.")).toBeTruthy();

    fetchAccountNotifications.mockResolvedValueOnce({ notifications: [], unread_count: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("You’re all caught up.")).toBeTruthy();
  });

  it("shows a toast and keeps the row unread when marking one as read fails", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 2 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [
        makeNotification(),
        makeNotification({
          id: "notif-2",
          title: "MFA break-glass used",
          body: "An operator used the emergency two-factor bypass.",
        }),
      ],
      unread_count: 2,
    });
    markAccountNotificationRead.mockRejectedValue(new Error("network down"));

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));

    expect(await screen.findByText("Failed to mark notification as read.")).toBeTruthy();
    // Both optimistic updates (the row's read_at and the badge count) must roll back on
    // rejection - previously only the toast fired, leaving the row shown as read and the badge
    // decremented even though the server never confirmed it (bot review finding).
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }).className,
    ).toContain("notif-bell__row--unread");
    // The other notification, never clicked, must stay exactly as it was.
    expect(
      screen.getByRole("menuitem", { name: /MFA break-glass used/ }).className,
    ).toContain("notif-bell__row--unread");
  });

  it("discards a poll response that resolves after a newer mark-read already updated the count", async () => {
    // No waitFor/findBy* below (they poll via real setTimeout internally, which never fires
    // under fake timers and just times the test out) - every async settle point uses a direct
    // act() instead, same convention as the "NotificationBell polling" describe block below.
    vi.useFakeTimers();
    fetchAccountNotificationsUnreadCount.mockResolvedValueOnce({ unread_count: 2 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 2,
    });
    markAccountNotificationRead.mockResolvedValue({ unread_count: 1 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();

    // The next poll tick (30s later) starts a request that stays pending until resolvePoll runs -
    // simulates it being in flight when a newer, user-initiated count change happens.
    let resolvePoll: (value: { unread_count: number }) => void = () => {};
    fetchAccountNotificationsUnreadCount.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePoll = resolve; }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();

    // The stale poll (started before the mark-read click) finally resolves with the old count -
    // it must be discarded rather than stomping the newer, already-applied value.
    await act(async () => {
      resolvePoll({ unread_count: 2 });
    });
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
  });

  it("shows a toast when 'Mark all as read' fails", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    markAllAccountNotificationsRead.mockRejectedValue(new Error("network down"));

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));

    expect(await screen.findByText("Failed to mark all as read.")).toBeTruthy();
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

  it("leaves other notifications untouched when marking one read", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 2 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [
        makeNotification({ id: "notif-1" }),
        makeNotification({ id: "notif-2", title: "MFA break-glass used" }),
      ],
      unread_count: 2,
    });
    markAccountNotificationRead.mockResolvedValue({ unread_count: 1 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("MFA break-glass used");

    fireEvent.click(screen.getByRole("menuitem", { name: /^5 consecutive failed sign-in attempts/ }));

    await waitFor(() => expect(markAccountNotificationRead).toHaveBeenCalledWith("notif-1"));
    const otherRow = screen.getByRole("menuitem", { name: /MFA break-glass used/ });
    expect(otherRow.className).toContain("notif-bell__row--unread");
  });

  it("falls back to a generic icon for a severity not in the icon map", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification({ severity: "unknown" as NotificationDto["severity"] })],
      unread_count: 1,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    expect(document.querySelector(".ti-info-circle")).toBeTruthy();
  });

  it("omits the organization prefix when a notification has no organization_name", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification({ organization_name: null })],
      unread_count: 1,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    expect(screen.queryByText(/Demo Org/)).toBeNull();
  });
});

describe("NotificationBell abort races", () => {
  it("does not update state after unmounting mid-poll", async () => {
    let resolveCount: (value: { unread_count: number }) => void = () => {};
    fetchAccountNotificationsUnreadCount.mockImplementation(
      () => new Promise((resolve) => { resolveCount = resolve; }),
    );

    const { unmount } = renderWithToast(<NotificationBell />);
    await act(async () => {});
    unmount();

    await act(async () => {
      resolveCount({ unread_count: 7 });
      await Promise.resolve();
    });
    // No crash and nothing left to query - the effect's own AbortController was already
    // aborted by unmount's cleanup, so the resolved promise's `if (ac.signal.aborted) return;`
    // guard discards it instead of calling setState on an unmounted component.
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
  });

  it("discards a list fetch that resolves after the dropdown has already closed", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    let resolveList: (value: { notifications: NotificationDto[]; unread_count: number }) => void = () => {};
    fetchAccountNotifications.mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve; }),
    );

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await act(async () => {});
    openBell();

    await act(async () => {
      resolveList({ notifications: [makeNotification()], unread_count: 1 });
      await Promise.resolve();
    });
    // Closed before the fetch resolved - the stale response must not reopen or repopulate the
    // panel via the aborted request's own state updates.
    expect(screen.queryByText("5 consecutive failed sign-in attempts")).toBeNull();
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
