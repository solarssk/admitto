import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@admitto/ui";
import { fetchAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { AuditLogEntryDto } from "../api/types.js";
import { formatUtcDateTime, utcDayEndIso, utcDayStartIso } from "../utils/event-dates.js";

/** Human-readable labels for `AdminAuditLog.action_type` (current + planned IAM types). */
const ACTION_LABELS: Record<string, string> = {
  account_mfa_enrolled: "2FA enrolled (self-service)",
  account_mfa_reset: "2FA reset (self-service)",
  account_password_changed: "Password changed (self-service)",
  account_session_revoked: "Session revoked (self-service)",
  attendee_created_manual: "Attendee created manually",
  attendee_erased: "Attendee erased (GDPR)",
  attendees_bulk_erased: "Attendees bulk erased (GDPR)",
  event_archived: "Event archived",
  event_created: "Event created",
  event_pii_exported: "Event PII exported",
  event_unarchived: "Event unarchived",
  event_updated: "Event updated",
  mail_settings_updated: "Mail settings updated",
  mail_transport_tested: "Mail transport tested",
  operator_sessions_bulk_revoked: "Operator sessions revoked",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  session_revoked: "Session revoked",
  system_settings_updated: "System settings updated",
  user_created: "User created",
  user_deactivated: "User deactivated",
  user_mfa_reset: "2FA reset",
  user_password_reset: "Password reset",
  user_reactivated: "User reactivated",
};

/** Map a raw action_type to a display label, falling back to the raw value. */
function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type;
}

const ACTION_OPTIONS = Object.keys(ACTION_LABELS).sort((a, b) =>
  actionLabel(a).localeCompare(actionLabel(b)),
);

const PAGE_SIZE = 25;

/** Format an ISO timestamp for the audit log table. */
function formatTimestamp(iso: string): string {
  return formatUtcDateTime(iso);
}

/** Primary actor label; deleted users show a readable fallback (id in cell title). */
function actorDisplay(entry: AuditLogEntryDto): string {
  if (entry.actor_display_name) return entry.actor_display_name;
  if (entry.actor_email) return entry.actor_email;
  return "Deleted user";
}

/** Tooltip for actor cell when the backing user row no longer exists. */
function actorTitle(entry: AuditLogEntryDto): string | undefined {
  if (entry.actor_display_name || entry.actor_email) return undefined;
  return entry.actor_user_id;
}

/** True when metadata is a non-empty object worth rendering in the Details column. */
function hasMetadata(metadata: Record<string, unknown> | null): boolean {
  return !!metadata && Object.keys(metadata).length > 0;
}

/** Pretty-print audit metadata JSON for the expandable Details cell. */
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
          start: filters.start ? utcDayStartIso(filters.start) : undefined,
          end: filters.end ? utcDayEndIso(filters.end) : undefined,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      const maxPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (page > maxPage) {
        setEntries([]);
        setPage(maxPage);
        return;
      }
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(operatorApiErrorMessage(err, "Failed to load audit log."));
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
        <p className="audit-log-empty">
          {total > 0
            ? "No entries on this page."
            : hasActiveFilters
              ? "No audit log entries match the filters."
              : "No audit log entries found."}
        </p>
      ) : (
        <div className="sessions-table-wrap">
          <table className="table audit-log-table">
            <thead>
              <tr>
                <th scope="col">Time (UTC)</th>
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
                  <td title={actorTitle(entry)}>
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
