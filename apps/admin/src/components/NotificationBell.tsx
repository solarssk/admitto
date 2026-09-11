import { useCallback, useEffect, useRef, useState } from "react";
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

/** In-memory cache for the unread count, same reasoning and shape as SystemStatus's own
 * checksCache: StaffShell (which renders this component) is mounted separately by each top-level
 * shell (EventsListShell/AdminShell/OperatorShell/InstanceSettingsShell aren't nested under one
 * another), so NotificationBell remounts on every switch between them - without this, the badge
 * would flash back to 0 on every navigation until the next fetch resolved (PO report). Use
 * `resetNotificationBellCache()` between tests to avoid leaking state across cases. */
let unreadCountCache: { value: number; expiresAt: number } | null = null;

export function resetNotificationBellCache(): void {
  unreadCountCache = null;
}

/**
 * Topbar notification bell (notifications-module-foundation plan, PR4) - unlike SystemStatus,
 * which vanishes entirely when it has nothing to report (rows.length === 0 → null, a healthy
 * signal), the bell always renders: a vanishing bell at 0 unread would read as broken, not as
 * "nothing wrong".
 */
export function NotificationBell() {
  const { addToast } = useToast();
  const { open, setOpen, panelStyle, rootRef, triggerRef, panelRef } = useDropdownMenu<HTMLButtonElement>({
    align: "end",
    gap: 8,
  });
  const [unreadCount, setUnreadCount] = useState(
    unreadCountCache && unreadCountCache.expiresAt > Date.now() ? unreadCountCache.value : 0,
  );
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Every count-changing operation (poll tick, list load, mark-read, mark-all-read) claims the
  // next generation the moment it starts, before its own network round-trip - whichever one
  // started most recently always wins. Without this, a poll tick already in flight when the user
  // marks something read could resolve afterward with its own now-stale count and silently
  // overwrite the newer, user-confirmed value (bot review finding).
  const countGenerationRef = useRef(0);

  // Every server-confirmed count goes through here so the cache never drifts from what's on
  // screen - missing even one call site would mean a stale count flashing back in on the next
  // remount (see unreadCountCache's own doc comment). `gen` must be the value countGenerationRef
  // held at the moment this operation started; a result from an operation superseded by a later
  // one is silently discarded instead of applied.
  function setConfirmedUnreadCount(value: number, gen: number) {
    if (gen !== countGenerationRef.current) return;
    setUnreadCount(value);
    unreadCountCache = { value, expiresAt: Date.now() + UNREAD_POLL_MS };
  }

  // Chains mark-read/mark-all-read network calls one at a time, in click order - generation
  // numbers alone aren't enough between two mutations, only between a mutation and the passive
  // poll/list-load. Two mark-read calls can each return a *correct, freshly re-queried* count at
  // the moment they individually complete server-side; if they ran concurrently, "started later"
  // and "reflects the latest write" aren't the same request, and discarding by start order could
  // throw away the one with the truly newer server state (bot review finding). Serializing removes
  // the ambiguity: only one mutation is ever in flight, so whichever one is currently running is
  // always the freshest by construction, and the poll/list-load vs. mutation race is still handled
  // by countGenerationRef, claimed here at actual dispatch time (its turn in the queue), not at
  // click time.
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  function queueMutation(run: () => Promise<void>): Promise<void> {
    const next = mutationQueueRef.current.then(run, run);
    mutationQueueRef.current = next;
    return next;
  }

  // Poll the cheap unread-count endpoint continuously; the fuller list is fetched lazily below,
  // only when the dropdown is actually opened - no reason to re-render its list every 30s while
  // a user might be mid-read in the panel.
  useEffect(() => {
    let currentAbort: AbortController | null = null;

    // `silent` here means "skip the network round-trip if the cache is still fresh" (a remount
    // right after a previous one), not an error-display distinction like SystemStatus's own
    // silent/non-silent split - there's no error/degraded state on the bell to gate on a
    // first-fetch-only basis. A failed tick (poll or initial) just keeps the last-known value;
    // retried by the next interval tick.
    async function loadCount(silent: boolean) {
      const gen = ++countGenerationRef.current;
      if (!silent && unreadCountCache && unreadCountCache.expiresAt > Date.now()) {
        setUnreadCount(unreadCountCache.value);
        return;
      }
      const ac = new AbortController();
      currentAbort = ac;
      try {
        const data = await fetchAccountNotificationsUnreadCount(ac.signal);
        if (ac.signal.aborted) return;
        setConfirmedUnreadCount(data.unread_count, gen);
      } catch {
        // Keep the last-known value; retried by the next interval tick.
      }
    }

    void loadCount(false);
    const intervalId = setInterval(() => void loadCount(true), UNREAD_POLL_MS);
    return () => {
      currentAbort?.abort();
      clearInterval(intervalId);
    };
  }, []);

  const loadList = useCallback(async (signal?: AbortSignal) => {
    setListLoading(true);
    setListError(null);
    const gen = ++countGenerationRef.current;
    try {
      const data = await fetchAccountNotifications(signal);
      if (signal?.aborted) return;
      setNotifications(data.notifications);
      setConfirmedUnreadCount(data.unread_count, gen);
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
    await queueMutation(async () => {
      const gen = ++countGenerationRef.current;
      try {
        const result = await markAccountNotificationRead(notification.id);
        setConfirmedUnreadCount(result.unread_count, gen);
      } catch (err) {
        // Undo both optimistic updates - the row was never actually confirmed read server-side,
        // so leaving it displayed as read (and the badge decremented) would contradict the
        // failure toast until the next list reload or poll tick (bot review finding).
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, read_at: null } : n)),
        );
        setUnreadCount((c) => c + 1);
        addToast(operatorApiErrorMessage(err, "Failed to mark notification as read."), "error");
      }
    });
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    await queueMutation(async () => {
      const gen = ++countGenerationRef.current;
      try {
        const result = await markAllAccountNotificationsRead();
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
        setConfirmedUnreadCount(result.unread_count, gen);
      } catch (err) {
        addToast(operatorApiErrorMessage(err, "Failed to mark all as read."), "error");
      } finally {
        setMarkingAll(false);
      }
    });
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
            <div className="notif-bell__list at-scroll">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  className={`user-menu__item notif-bell__row${n.read_at ? "" : " notif-bell__row--unread"}`}
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
                    <span className="notif-bell__row-body">{n.body}</span>
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
