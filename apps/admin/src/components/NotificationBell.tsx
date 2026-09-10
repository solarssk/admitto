import { useCallback, useEffect, useState } from "react";
import { Badge, Spinner, useToast } from "@admitto/ui";
import {
  fetchAccountNotifications,
  fetchAccountNotificationsUnreadCount,
  markAccountNotificationRead,
  markAllAccountNotificationsRead,
} from "../api/client.js";
import type { NotificationDto } from "../api/types.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { formatRelativeTime } from "../utils/event-dates.js";
import { NOTIFICATION_SEVERITY_ICON } from "./notificationSeverity.js";
import { useDropdownMenu } from "./useDropdownMenu.js";

/** Silent poll interval for the unread count - same cadence as SystemStatus's own health poll,
 * but independently defined (not imported) since it's a different concern with its own reason
 * for the number, not the same constant reused. */
const UNREAD_POLL_MS = 30_000;

/**
 * Topbar notification bell (notifications-module-foundation plan, PR4) - unlike SystemStatus,
 * which vanishes entirely when it has nothing to report (rows.length === 0 → null, a healthy
 * signal), the bell always renders: a vanishing bell at 0 unread would read as broken, not as
 * "nothing wrong". No module-level cache the way SystemStatus's checksCache is - that exists to
 * dedupe re-fetches across SystemStatus's own frequent remounts (StaffShell switches), but this
 * component lives in that same always-mounted shell location and never remounts that way.
 */
export function NotificationBell() {
  const { addToast } = useToast();
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
    gap: 8,
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Poll the cheap unread-count endpoint continuously; the fuller list is fetched lazily below,
  // only when the dropdown is actually opened - no reason to re-render its list every 30s while
  // a user might be mid-read in the panel.
  useEffect(() => {
    let currentAbort: AbortController | null = null;

    // No distinct silent/non-silent branches, unlike SystemStatus's own poll: there's no
    // error/degraded state on the bell to gate on a first-fetch-only basis - a failed tick (poll
    // or initial) just keeps the last-known count and the next tick 30s later tries again.
    async function loadCount() {
      const ac = new AbortController();
      currentAbort = ac;
      try {
        const data = await fetchAccountNotificationsUnreadCount(ac.signal);
        if (ac.signal.aborted) return;
        setUnreadCount(data.unread_count);
      } catch {
        // Keep the last-known value; retried by the next interval tick.
      }
    }

    void loadCount();
    const intervalId = setInterval(() => void loadCount(), UNREAD_POLL_MS);
    return () => {
      currentAbort?.abort();
      clearInterval(intervalId);
    };
  }, []);

  const loadList = useCallback(async (signal?: AbortSignal) => {
    setListLoading(true);
    setListError(null);
    try {
      const data = await fetchAccountNotifications(signal);
      if (signal?.aborted) return;
      setNotifications(data.notifications);
      setUnreadCount(data.unread_count);
      setListLoaded(true);
    } catch (err) {
      if (signal?.aborted) return;
      setListError(operatorApiErrorMessage(err, "Could not load notifications."));
    } finally {
      if (!signal?.aborted) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    void loadList(ac.signal);
    return () => ac.abort();
  }, [open, loadList]);

  async function handleRowClick(notification: NotificationDto) {
    if (notification.read_at) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const result = await markAccountNotificationRead(notification.id);
      setUnreadCount(result.unread_count);
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to mark notification as read."), "error");
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      const result = await markAllAccountNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
      setUnreadCount(result.unread_count);
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to mark all as read."), "error");
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu__trigger notif-bell__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        onClick={() => setOpen((o) => !o)}
        ref={triggerRef}
      >
        <span className="notif-bell__icon-wrap">
          <i className="ti ti-bell" aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge variant="error" className="notif-bell__badge">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </span>
      </button>
      {open && (
        <div className="user-menu__panel sys-status__panel notif-bell__panel" role="menu" ref={panelRef} style={panelStyle}>
          <div className="notif-bell__head">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <button
                type="button"
                className="notif-bell__mark-all"
                disabled={markingAll}
                onClick={() => void handleMarkAllRead()}
              >
                {markingAll ? "Marking…" : "Mark all as read"}
              </button>
            )}
          </div>
          {listLoading && !listLoaded && (
            <div className="notif-bell__status">
              <Spinner label="Loading notifications" />
            </div>
          )}
          {!listLoading && listError && (
            <div className="notif-bell__status">
              <p>{listError}</p>
              <button type="button" className="notif-bell__retry" onClick={() => void loadList()}>
                Retry
              </button>
            </div>
          )}
          {!listError && listLoaded && notifications.length === 0 && (
            <div className="notif-bell__status">
              <i className="ti ti-bell-off" aria-hidden="true" />
              <p>You&rsquo;re all caught up.</p>
            </div>
          )}
          {!listError && notifications.length > 0 && (
            <div className="notif-bell__list">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  className={`user-menu__item notif-bell__row${n.read_at ? "" : " notif-bell__row--unread"}`}
                  title={n.body}
                  onClick={() => void handleRowClick(n)}
                >
                  <span
                    className={`status-circle status-circle--sm status-circle--${n.severity}`}
                    aria-hidden="true"
                  >
                    <i className={`ti ${NOTIFICATION_SEVERITY_ICON[n.severity] ?? "ti-info-circle"}`} aria-hidden="true" />
                  </span>
                  <span className="user-menu__item-text">
                    <strong>{n.title}</strong>
                    <span>
                      {n.organization_name ? `${n.organization_name} · ` : ""}
                      {formatRelativeTime(n.created_at)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
