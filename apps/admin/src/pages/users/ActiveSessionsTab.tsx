import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Tooltip, useToast } from "@admitto/ui";
import {
  fetchAdminEvents,
  fetchSessions,
  revokeAllOperatorSessions,
  revokeSessionById,
} from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { EventDto, SessionListDto } from "../../api/types.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Segmented, type SegmentedOption } from "../../components/Segmented.js";
import { DeviceLabelEditModal } from "./DeviceLabelEditModal.js";
import { LOGGED_IN_HINT, SessionCard, SessionTableRow } from "./SessionListItem.js";
import { useDelayedLoading } from "../../hooks/useDelayedLoading.js";
import { useIsDesktop } from "../../hooks/useIsDesktop.js";
import { formatRelativeTime } from "../../utils/event-dates.js";

type FilterValue = "all" | "admin" | "operator";

const FILTER_OPTIONS: ReadonlyArray<SegmentedOption<FilterValue>> = [
  { value: "all", label: "All" },
  { value: "admin", label: "Admins" },
  { value: "operator", label: "Operators" },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 25;

interface ActiveSessionsTabProps {
  /** Reports the loaded (unfiltered) session count up to the parent tab bar, mirroring how
   * "Staff users" already shows its own count next to its tab label. */
  onCountChange?: (count: number) => void;
}

/** Users & roles — Active sessions tab: lists active staff sessions, per-session revoke, and bulk operator-session revoke by event. */
export function ActiveSessionsTab({ onCountChange }: Readonly<ActiveSessionsTabProps>) {
  const { addToast } = useToast();
  const [sessions, setSessions] = useState<SessionListDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [confirmTarget, setConfirmTarget] = useState<SessionListDto | null>(null);
  const [revoking, setRevoking] = useState(false);

  const [editTarget, setEditTarget] = useState<SessionListDto | null>(null);

  const [events, setEvents] = useState<EventDto[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkRevoking, setBulkRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSessions();
      setSessions(data.sessions);
      onCountChange?.(data.sessions.length);
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to load sessions.");
      setError(message);
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast, onCountChange]);

  useEffect(() => {
    void load();
    fetchAdminEvents({ includeArchived: true })
      .then(setEvents)
      .catch(() => {});
  }, [load]);

  const displayed = sessions.filter((s) => {
    if (filter === "admin") return s.role === "admin" || s.role === "superadmin";
    if (filter === "operator") return s.role === "operator";
    return true;
  });
  const total = displayed.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageSlice = displayed.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);

  const handleRevoke = async () => {
    if (!confirmTarget) return;
    setRevoking(true);
    try {
      await revokeSessionById(confirmTarget.id);
      setConfirmTarget(null);
      addToast("Session revoked.", "success");
      await load();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to revoke session."), "error");
    } finally {
      setRevoking(false);
    }
  };

  const handleBulkRevoke = async () => {
    if (!selectedEventId) return;
    setBulkRevoking(true);
    try {
      const { revokedCount } = await revokeAllOperatorSessions(selectedEventId);
      addToast(
        `Revoked ${revokedCount} operator session${revokedCount === 1 ? "" : "s"}.`,
        "success",
      );
      setBulkConfirmOpen(false);
      await load();
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to revoke sessions."), "error");
    } finally {
      setBulkRevoking(false);
    }
  };

  const selectedEvent = events.find((e) => e.id === selectedEventId);
  const confirmDeviceSuffix = confirmTarget?.deviceLabel
    ? ` (${confirmTarget.deviceLabel})`
    : "";

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the "Loading…" text on and off faster than it can register as loading — show it only
  // once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);
  // Desktop table vs. stacked mobile cards, same breakpoint-driven switch as AuditLogPanel -
  // only one ever renders (not both-with-CSS-hiding), so a row's content never appears twice.
  const isDesktop = useIsDesktop();

  return (
    <>
      <Card
        title="Sessions"
        actions={
          <Segmented
            ariaLabel="Filter sessions by role"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPage(1);
            }}
            options={FILTER_OPTIONS}
            className="sessions-filter-toggle"
          />
        }
      >
        {loading && showLoading && <p className="sessions-status">Loading…</p>}

        {!loading && error && (
          <div className="sessions-status">
            <p>{error}</p>
            <Button type="button" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && total === 0 && sessions.length === 0 && (
          <EmptyState
            icon={<i className="ti ti-plug-connected" aria-hidden="true" />}
            title="No active sessions"
            description="Staff sessions will appear here once someone signs in."
          />
        )}

        {!loading && !error && total === 0 && sessions.length > 0 && (
          <EmptyState
            icon={<i className="ti ti-filter-off" aria-hidden="true" />}
            title="No sessions match this filter"
            description="Select All to see every active staff session."
          />
        )}

        {!loading && !error && total > 0 && (
          <>
            {isDesktop ? (
              <div className="sessions-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Role</th>
                      <th className="sessions-col-tablet-hide">Device</th>
                      <th className="sessions-col-tablet-hide">IP address</th>
                      <th>
                        <Tooltip content={LOGGED_IN_HINT} className="sessions-col-header">
                          Logged in <i className="ti ti-info-circle" aria-hidden="true" />
                        </Tooltip>
                      </th>
                      <th>Last active</th>
                      <th className="sessions-col-tablet-hide">Sign-in</th>
                      <th className="sessions-action-col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSlice.map((s) => (
                      <SessionTableRow key={s.id} session={s} onEdit={setEditTarget} onRevoke={setConfirmTarget} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="users-page__cards users-page__cards--mobile">
                {pageSlice.map((s) => (
                  <SessionCard key={s.id} session={s} onEdit={setEditTarget} onRevoke={setConfirmTarget} />
                ))}
              </div>
            )}

            <div className="sessions-footer">
              <div className="sessions-footer__summary">
                <span className="sessions-footer__info">
                  {`Showing ${(effectivePage - 1) * pageSize + 1}–${Math.min(effectivePage * pageSize, total)} of ${total}`}
                </span>
                <div className="sessions-pagesize">
                  <label htmlFor="sessions-pagesize-select">Rows per page</label>
                  <select
                    id="sessions-pagesize-select"
                    name="sessions-pagesize-select"
                    className="at-select sessions-pagesize-select"
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="sessions-footer__pager">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={effectivePage <= 1}
                  onClick={() => setPage(Math.max(1, effectivePage - 1))}
                >
                  Previous
                </Button>
                <span>
                  Page {effectivePage} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={effectivePage >= totalPages}
                  onClick={() => setPage(Math.min(totalPages, effectivePage + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card title="Bulk revoke operator sessions">
        <p className="sessions-hint">
          Immediately end all active operator sessions for a specific event.
        </p>
        <div className="sessions-bulk-row">
          <select
            id="sessions-bulk-revoke-event"
            name="sessions-bulk-revoke-event"
            className="at-select"
            aria-label="Event"
            value={selectedEventId}
            onChange={(e) => {
              setSelectedEventId(e.target.value);
            }}
          >
            <option value="">Select event…</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
                {e.archived_at ? " (archived)" : ""}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="danger"
            disabled={!selectedEventId}
            onClick={() => setBulkConfirmOpen(true)}
          >
            Revoke all operator sessions
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirmTarget}
        title="Revoke session"
        message={
          confirmTarget
            ? `Revoke session for ${confirmTarget.userEmail}${confirmDeviceSuffix}? Last active ${formatRelativeTime(confirmTarget.lastSeenAt)}.`
            : ""
        }
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={revoking}
        onConfirm={() => void handleRevoke()}
        onCancel={() => {
          if (!revoking) setConfirmTarget(null);
        }}
      />

      <DeviceLabelEditModal
        open={!!editTarget}
        session={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          addToast("Device label updated.", "success");
          void load();
        }}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        title="Revoke all operator sessions"
        message={
          selectedEvent
            ? `This will immediately end all active operator sessions for "${selectedEvent.title}". This cannot be undone.`
            : "This will immediately end all active operator sessions for the selected event."
        }
        confirmLabel="Revoke"
        confirmVariant="danger"
        loading={bulkRevoking}
        onConfirm={() => void handleBulkRevoke()}
        onCancel={() => {
          if (!bulkRevoking) setBulkConfirmOpen(false);
        }}
      />
    </>
  );
}
