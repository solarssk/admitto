import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Spinner, Tooltip, useToast } from "@admitto/ui";
import {
  clearAllAccountNotifications,
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
import { ConfirmDialog } from "./ConfirmDialog.js";

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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Guards every queued operation below against running its state updates after unmount - a
  // StaffShell remount (see unreadCountCache's own doc comment) can happen while an operation is
  // still queued behind another, not yet even dispatched, so the usual AbortController-on-
  // cleanup alone doesn't cover it (there's nothing to abort yet for something that hasn't
  // started).
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Every count-changing or count-reading operation (poll tick, list load, mark-read,
  // mark-all-read) claims the next generation right before it actually queries the server -
  // whichever one is currently running is always the freshest. Without this, an operation already
  // in flight when a newer one starts could resolve afterward with its own now-stale count and
  // silently overwrite the newer value (bot review finding).
  const countGenerationRef = useRef(0);

  // Every server-confirmed count goes through here so the cache never drifts from what's on
  // screen - missing even one call site would mean a stale count flashing back in on the next
  // remount (see unreadCountCache's own doc comment). `gen` must be the value countGenerationRef
  // held at the moment this operation started; a result from an operation superseded by a later
  // one is silently discarded instead of applied.
  function setConfirmedUnreadCount(value: number, gen: number) {
    if (gen !== countGenerationRef.current || !isMountedRef.current) return;
    setUnreadCount(value);
    unreadCountCache = { value, expiresAt: Date.now() + UNREAD_POLL_MS };
  }

  // Serializes every operation that reads or writes the unread count onto one shared queue - the
  // passive poll and list load, not just the mark-read/mark-all-read mutations. Generation numbers
  // alone aren't enough: an operation that *starts* after another can still query the database
  // before that other one's own write commits (a slow mark-read PATCH, a poll ticking in the
  // meantime), returning a stale count while claiming a newer generation - the mutation's later,
  // genuinely fresh response then gets discarded for looking "older" (bot review finding).
  // Serializing removes the ambiguity entirely: only one of these operations is ever actually
  // running (and therefore actually querying the database) at a time, so whichever is currently
  // executing is always the freshest by construction - generation numbers then only need to label
  // results for setConfirmedUnreadCount, not adjudicate between concurrent requests, since there
  // never are any.
  const countQueueRef = useRef<Promise<void>>(Promise.resolve());
  function queueCountOperation(run: () => Promise<void>): Promise<void> {
    const next = countQueueRef.current.then(run, run);
    countQueueRef.current = next;
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
    function loadCount(silent: boolean): Promise<void> {
      return queueCountOperation(async () => {
        if (!isMountedRef.current) return;
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
      });
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
    await queueCountOperation(async () => {
      if (!isMountedRef.current || signal?.aborted) return;
      const gen = ++countGenerationRef.current;
      try {
        const data = await fetchAccountNotifications(signal);
        if (signal?.aborted || !isMountedRef.current) return;
        setNotifications(data.notifications);
        setConfirmedUnreadCount(data.unread_count, gen);
        setListLoaded(true);
      } catch (err) {
        if (signal?.aborted || !isMountedRef.current) return;
        setListError(operatorApiErrorMessage(err, "Could not load notifications."));
      } finally {
        if (!signal?.aborted && isMountedRef.current) setListLoading(false);
      }
    });
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
    await queueCountOperation(async () => {
      if (!isMountedRef.current) return;
      const gen = ++countGenerationRef.current;
      try {
        const result = await markAccountNotificationRead(notification.id);
        setConfirmedUnreadCount(result.unread_count, gen);
      } catch (err) {
        if (!isMountedRef.current) return;
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
    await queueCountOperation(async () => {
      if (!isMountedRef.current) return;
      const gen = ++countGenerationRef.current;
      try {
        const result = await markAllAccountNotificationsRead();
        if (!isMountedRef.current) return;
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
        setConfirmedUnreadCount(result.unread_count, gen);
      } catch (err) {
        if (isMountedRef.current) {
          addToast(operatorApiErrorMessage(err, "Failed to mark all as read."), "error");
        }
      } finally {
        if (isMountedRef.current) setMarkingAll(false);
      }
    });
  }

  async function handleClearAll() {
    setClearing(true);
    await queueCountOperation(async () => {
      if (!isMountedRef.current) return;
      const gen = ++countGenerationRef.current;
      try {
        await clearAllAccountNotifications();
        if (!isMountedRef.current) return;
        setNotifications([]);
        setConfirmedUnreadCount(0, gen);
        setClearConfirmOpen(false);
      } catch (err) {
        if (isMountedRef.current) {
          addToast(operatorApiErrorMessage(err, "Failed to clear notifications."), "error");
        }
      } finally {
        if (isMountedRef.current) setClearing(false);
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
            <div className="notif-bell__head-actions">
              {unreadCount > 0 && (
                <Tooltip content="Mark all as read">
                  <button
                    type="button"
                    className="notif-bell__icon-action"
                    aria-label={markingAll ? "Marking…" : "Mark all as read"}
                    disabled={markingAll}
                    onClick={() => void handleMarkAllRead()}
                  >
                    {markingAll ? <Spinner size="sm" label="Marking" /> : <i className="ti ti-checks" aria-hidden="true" />}
                  </button>
                </Tooltip>
              )}
              {notifications.length > 0 && (
                <Tooltip content="Clear all">
                  <button
                    type="button"
                    className="notif-bell__icon-action"
                    aria-label="Clear all"
                    disabled={clearing}
                    onClick={() => setClearConfirmOpen(true)}
                  >
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
            </div>
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
      <ConfirmDialog
        open={clearConfirmOpen}
        icon={<i className="ti ti-trash" />}
        title="Clear all notifications?"
        message="This permanently deletes your notification history. It does not affect your organisation's security audit log, and future alerts will still arrive normally."
        confirmLabel="Clear all notifications"
        confirmVariant="danger"
        loading={clearing}
        onConfirm={() => void handleClearAll()}
        onCancel={() => setClearConfirmOpen(false)}
      />
    </div>
  );
}
