// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationBell, resetNotificationBellCache } from "../../src/components/NotificationBell.js";
import type { NotificationDto } from "../../src/api/types.js";
import { renderWithToast } from "../test-utils.js";

const fetchAccountNotifications = vi.fn();
const fetchAccountNotificationsUnreadCount = vi.fn();
const markAccountNotificationRead = vi.fn();
const markAllAccountNotificationsRead = vi.fn();
const clearAllAccountNotifications = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAccountNotifications: (...args: unknown[]) => fetchAccountNotifications(...args),
    fetchAccountNotificationsUnreadCount: (...args: unknown[]) => fetchAccountNotificationsUnreadCount(...args),
    markAccountNotificationRead: (...args: unknown[]) => markAccountNotificationRead(...args),
    markAllAccountNotificationsRead: (...args: unknown[]) => markAllAccountNotificationsRead(...args),
    clearAllAccountNotifications: (...args: unknown[]) => clearAllAccountNotifications(...args),
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

    // The actual network call is queued (fires on the next microtask, not synchronously in the
    // click handler) so two mark-read/mark-all-read mutations can never run concurrently.
    await waitFor(() => expect(markAccountNotificationRead).toHaveBeenCalledWith("notif-1"));
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

  it("queues mark-read behind a pending poll tick, so the poll can never apply a stale count after it", async () => {
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

    // Open the dropdown before the poll tick, so the list is already loaded and the shared queue
    // is empty when the poll starts.
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await act(async () => {});

    // The next poll tick (30s later) starts a request that stays pending until resolvePoll runs -
    // simulates it still being in flight when the user marks something read.
    let resolvePoll: (value: { unread_count: number }) => void = () => {};
    fetchAccountNotificationsUnreadCount.mockImplementationOnce(
      () => new Promise((resolve) => { resolvePoll = resolve; }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // The poll's own request is now queued/in-flight - the click's own mark-read call is queued
    // behind it and must not fire yet (the shared queue, not generation numbers, is what
    // prevents a stale poll from ever outliving a newer mutation now).
    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));
    await act(async () => {});
    expect(markAccountNotificationRead).not.toHaveBeenCalled();

    await act(async () => {
      resolvePoll({ unread_count: 2 });
    });

    // Only now does the queued mark-read actually run, and its response is the final word.
    await act(async () => {});
    expect(markAccountNotificationRead).toHaveBeenCalledWith("notif-1");
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
  });

  it("queues a dropdown reopen behind a pending mutation instead of showing stale list data", async () => {
    // Regression test for the Codex review finding: reopening the dropdown while a mark-read is
    // still in flight used to start a second, unqueued list fetch that could apply a pre-mutation
    // snapshot after the mutation's own optimistic update, silently un-reading the row again.
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValueOnce({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    let resolveMarkRead: (value: { unread_count: number }) => void = () => {};
    markAccountNotificationRead.mockImplementationOnce(
      () => new Promise((resolve) => { resolveMarkRead = resolve; }),
    );

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("menuitem", { name: /5 consecutive failed sign-in attempts/ }));
    await act(async () => {});
    expect(fetchAccountNotifications).toHaveBeenCalledTimes(1);

    // Close, then reopen while the mark-read is still pending - queues a second list fetch.
    openBell();
    fetchAccountNotifications.mockResolvedValueOnce({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    openBell();
    await act(async () => {});

    // The reopen's own fetch must stay queued behind the still-pending mutation.
    expect(fetchAccountNotifications).toHaveBeenCalledTimes(1);

    resolveMarkRead({ unread_count: 0 });
    await act(async () => {});

    await waitFor(() => expect(fetchAccountNotifications).toHaveBeenCalledTimes(2));
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

    await waitFor(() => expect(markAllAccountNotificationsRead).toHaveBeenCalled());
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

  it("serializes two quick mark-read clicks so the badge settles on the true final count", async () => {
    // Regression test for the bot review finding: without a queue, two concurrent mark-read
    // requests can resolve out of order, and discarding by generation/start-order alone could
    // throw away the one whose *server-side write* actually happened last (the truly fresh
    // count), leaving the badge stuck at a wrong value until the next poll. Serializing removes
    // the ambiguity entirely - the second click's own request cannot even start until the first
    // one has fully resolved.
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 2 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [
        makeNotification({ id: "notif-1" }),
        makeNotification({
          id: "notif-2",
          title: "MFA break-glass used",
          body: "An operator used the emergency two-factor bypass.",
        }),
      ],
      unread_count: 2,
    });
    let resolveFirst: (value: { unread_count: number }) => void = () => {};
    markAccountNotificationRead.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("MFA break-glass used");

    fireEvent.click(screen.getByRole("menuitem", { name: /^5 consecutive failed sign-in attempts/ }));
    await waitFor(() => expect(markAccountNotificationRead).toHaveBeenCalledWith("notif-1"));

    markAccountNotificationRead.mockResolvedValueOnce({ unread_count: 0 });
    fireEvent.click(screen.getByRole("menuitem", { name: /MFA break-glass used/ }));

    // The second click's own network call must stay queued - not fired concurrently - while the
    // first one is still pending.
    await act(async () => {});
    expect(markAccountNotificationRead).toHaveBeenCalledTimes(1);

    // The first (slower) call resolves with a count that was already stale by the time it
    // arrives (notif-2 wasn't marked read server-side yet when it was computed) - the queue
    // means the second call only starts, and its own genuinely fresher count only applies,
    // after this one is fully done.
    resolveFirst({ unread_count: 1 });

    await waitFor(() => expect(markAccountNotificationRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
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

  it("does not update state after unmounting mid-clear-all", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    let resolveClear: (value: { cleared_count: number; unread_count: number }) => void = () => {};
    clearAllAccountNotifications.mockImplementation(
      () => new Promise((resolve) => { resolveClear = resolve; }),
    );

    const { unmount } = renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear all notifications?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all notifications" }));
    await act(async () => {});
    unmount();

    await act(async () => {
      resolveClear({ cleared_count: 1, unread_count: 0 });
      await Promise.resolve();
    });
    // No crash - the isMountedRef guard inside handleClearAll discards the late response
    // instead of calling setState on an unmounted component.
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

describe("Clear all", () => {
  it("does not show a Clear all trigger when the list is empty", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });
    fetchAccountNotifications.mockResolvedValue({ notifications: [], unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("You’re all caught up.");

    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("shows a Clear all trigger even when every notification is already read", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 0 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification({ read_at: "2026-09-10T11:00:00.000Z" })],
      unread_count: 0,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    // No unread rows - "Mark all as read" must not appear alongside it.
    expect(screen.queryByRole("button", { name: "Mark all as read" })).toBeNull();
  });

  it("asks for confirmation before clearing, and does nothing on Cancel", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear all notifications?" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(clearAllAccountNotifications).not.toHaveBeenCalled();
    expect(screen.getByText("5 consecutive failed sign-in attempts")).toBeTruthy();
  });

  it("closes only the confirm dialog on Escape, leaving the dropdown open behind it (bot review finding)", async () => {
    // Regression test: the dropdown's own useDropdownMenu instance used to stay registered in
    // openDropdownCount the whole time the dialog was open, so ConfirmDialog's Escape handler
    // always stepped aside (thinking a nested combobox was open) and the dropdown's own
    // bubble-phase Escape handler closed the panel instead, leaving the dialog orphaned.
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await screen.findByRole("dialog", { name: "Clear all notifications?" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Clear all notifications?" })).toBeNull(),
    );
    expect(clearAllAccountNotifications).not.toHaveBeenCalled();
    // The dropdown itself must still be open behind the now-closed dialog, not also closed by the
    // same Escape press.
    expect(screen.getByText("5 consecutive failed sign-in attempts")).toBeTruthy();
  });

  it("permanently clears the list and shows the empty state after confirming", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    clearAllAccountNotifications.mockResolvedValue({ cleared_count: 1, unread_count: 0 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear all notifications?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all notifications" }));

    await waitFor(() => expect(clearAllAccountNotifications).toHaveBeenCalled());
    await screen.findByText("You’re all caught up.");
    expect(screen.queryByText("5 consecutive failed sign-in attempts")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("applies the server's re-queried unread_count after clearing, not a hardcoded 0 (bot review finding)", async () => {
    // InAppChannel can insert a fresh unread notification between the server's delete and its
    // response - the badge must reflect that real count, not assume clearing always means 0.
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    clearAllAccountNotifications.mockResolvedValue({ cleared_count: 1, unread_count: 1 });

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear all notifications?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all notifications" }));

    await waitFor(() => expect(clearAllAccountNotifications).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy(),
    );
  });

  it("shows a toast and keeps the list when clearing fails", async () => {
    fetchAccountNotificationsUnreadCount.mockResolvedValue({ unread_count: 1 });
    fetchAccountNotifications.mockResolvedValue({
      notifications: [makeNotification()],
      unread_count: 1,
    });
    clearAllAccountNotifications.mockRejectedValue(new Error("network down"));

    renderWithToast(<NotificationBell />);
    await act(async () => {});
    openBell();
    await screen.findByText("5 consecutive failed sign-in attempts");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const dialog = await screen.findByRole("dialog", { name: "Clear all notifications?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all notifications" }));

    expect(await screen.findByText("Failed to clear notifications.")).toBeTruthy();
    expect(screen.getByText("5 consecutive failed sign-in attempts")).toBeTruthy();
  });
});
