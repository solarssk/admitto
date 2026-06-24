import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@admitto/ui";
import { ApiError, fetchAuditLog } from "../api/client.js";
import type { AuditLogEntryDto } from "../api/types.js";

const ACTION_LABELS: Record<string, string> = {
  attendee_edited: "Attendee edited",
  attendees_exported: "Attendees exported",
  attendees_imported: "Attendees imported",
  check_in: "Check-in",
  check_in_undo: "Check-in undone",
  event_archived: "Event archived",
  event_created: "Event created",
  event_item_created: "Item created",
  event_item_deleted: "Item deleted",
  event_item_updated: "Item updated",
  event_pii_exported: "Event PII exported",
  event_unarchived: "Event unarchived",
  event_updated: "Event updated",
  item_issued: "Item issued",
  item_returned: "Item returned",
  mail_settings_updated: "Mail settings updated",
  mail_template_updated: "Mail template updated",
  mail_test_sent: "Test mail sent",
  mail_transport_tested: "Mail transport tested",
  note_added: "Note added",
  operator_sessions_bulk_revoked: "Operator sessions revoked",
  ops_config_updated: "Ops config updated",
  scan_preview: "Scan preview",
  session_revoked: "Session revoked",
  system_settings_updated: "System settings updated",
  ticket_resent: "Ticket resent",
  user_created: "User created",
  user_deactivated: "User deactivated",
  user_reactivated: "User reactivated",
  user_mfa_reset: "2FA reset",
  user_password_reset: "Password reset",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
};

function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type;
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS).sort((a, b) =>
  actionLabel(a).localeCompare(actionLabel(b)),
);

const PAGE_SIZE = 25;

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function actorDisplay(entry: AuditLogEntryDto): string {
  return entry.actor_display_name ?? entry.actor_email ?? entry.actor_user_id;
}

function hasMetadata(metadata: Record<string, unknown> | null): boolean {
  return !!metadata && Object.keys(metadata).length > 0;
}

function metadataPreview(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata, null, 2);
}

/** Superadmin audit log viewer — read-only paginated table with action and date filters. */
export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ actionType: "", start: "", end: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuditLog(
        {
          page,
          pageSize: PAGE_SIZE,
          actionType: filters.actionType || undefined,
          start: filters.start || undefined,
          end: filters.end || undefined,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "Failed to load audit log.");
      setEntries([]);
      setTotal(0);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [page, filters.actionType, filters.start, filters.end]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const clearFilters = () => {
    setFilters({ actionType: "", start: "", end: "" });
    setPage(1);
  };

  const hasActiveFilters = useMemo(
    () => !!(filters.actionType || filters.start || filters.end),
    [filters.actionType, filters.start, filters.end],
  );

  return (
    <Card title="Audit log">
      <div className="audit-log-toolbar">
        <label className="audit-log-filter">
          <span className="audit-log-filter__label">Action</span>
          <select
            className="at-select"
            value={filters.actionType}
            onChange={(e) => {
              setFilters((f) => ({ ...f, actionType: e.target.value }));
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {actionLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label className="audit-log-filter">
          <span className="audit-log-filter__label">From</span>
          <input
            type="date"
            className="at-input"
            value={filters.start}
            onChange={(e) => {
              setFilters((f) => ({ ...f, start: e.target.value }));
              setPage(1);
            }}
          />
        </label>
        <label className="audit-log-filter">
          <span className="audit-log-filter__label">To</span>
          <input
            type="date"
            className="at-input"
            value={filters.end}
            onChange={(e) => {
              setFilters((f) => ({ ...f, end: e.target.value }));
              setPage(1);
            }}
          />
        </label>
        {hasActiveFilters && (
          <Button type="button" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {loading ? (
        <div className="audit-log-skeleton" aria-busy="true" aria-label="Loading audit log">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="audit-log-skeleton__row" />
          ))}
        </div>
      ) : error ? (
        <p className="audit-log-error">
          {error}{" "}
          <button type="button" className="settings-retry-link" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : entries.length === 0 ? (
        <p className="audit-log-empty">No audit log entries match the filters.</p>
      ) : (
        <div className="sessions-table-wrap">
          <table className="table audit-log-table">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">IP</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatTimestamp(entry.created_at)}</td>
                  <td>{actionLabel(entry.action_type)}</td>
                  <td>
                    {actorDisplay(entry)}
                    {entry.actor_display_name && entry.actor_email && (
                      <div className="sessions-subdued">{entry.actor_email}</div>
                    )}
                  </td>
                  <td>{entry.ip ?? "—"}</td>
                  <td>
                    {hasMetadata(entry.metadata) ? (
                      <details className="audit-log-details">
                        <summary className="audit-log-details__summary">View</summary>
                        <pre className="audit-log-metadata">{metadataPreview(entry.metadata!)}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && total > 0 && (
        <div className="audit-log-footer">
          <span className="audit-log-footer__info">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="audit-log-footer__buttons">
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
