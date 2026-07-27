import { Fragment, useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, type BadgeVariant } from "@admitto/ui";
import { fetchSecurityAuditLog } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { SecurityAuditLogEntryDto } from "../api/types.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatUtcDateTime } from "../utils/event-dates.js";

const PAGE_SIZE = 25;

/** Human-readable labels for SecurityAuditLog.event_type (issue #473's durable auth/security
 * event trail) - distinct from AdminAuditLog.action_type's ACTION_LABELS above it in this tab. */
const SECURITY_EVENT_LABELS: Record<string, string> = {
  "auth.login.success": "Login succeeded",
  "auth.login.fail": "Login failed",
  "auth.mfa.success": "2FA verified",
  "auth.mfa.fail": "2FA failed",
  "auth.mfa.break_glass": "2FA break-glass override",
  "auth.mfa.recovery_consumed": "2FA recovery code used",
  "auth.logout": "Logged out",
  "auth.oidc.success": "OIDC login succeeded",
  "auth.oidc.superadmin_revoke_blocked": "OIDC superadmin revoke blocked",
  "auth.access.denied": "Access denied",
};

function eventLabel(type: string): string {
  return SECURITY_EVENT_LABELS[type] ?? type;
}

/** Badge tone per event type - failures/denials read as `error`, break-glass/recovery (deliberate
 * but sensitive) as `warn`, successes as `ok`; logout stays the Badge default `neutral`. */
const TONE_BY_SECURITY_EVENT: Record<string, BadgeVariant> = {
  "auth.login.success": "ok",
  "auth.mfa.success": "ok",
  "auth.oidc.success": "ok",
  "auth.login.fail": "error",
  "auth.mfa.fail": "error",
  "auth.access.denied": "error",
  "auth.oidc.superadmin_revoke_blocked": "error",
  "auth.mfa.break_glass": "warn",
  "auth.mfa.recovery_consumed": "warn",
};

function eventTone(type: string): BadgeVariant {
  return TONE_BY_SECURITY_EVENT[type] ?? "neutral";
}

const EVENT_TYPE_OPTIONS = Object.keys(SECURITY_EVENT_LABELS).sort((a, b) =>
  eventLabel(a).localeCompare(eventLabel(b)),
);

/** Resolved display name for a row's subject - "Unknown" both when `user_id` is null
 * (enumeration-safe rows, e.g. failed logins) and when the user record itself has neither a
 * display name nor an email (already deleted). */
function userDisplay(entry: SecurityAuditLogEntryDto): string {
  if (!entry.user_id) return "Unknown";
  return entry.user_display_name || entry.user_email || "Unknown";
}

function hasMetadata(entry: SecurityAuditLogEntryDto): boolean {
  return entry.metadata != null && Object.keys(entry.metadata).length > 0;
}

/**
 * Settings panel — durable auth/security event trail (issue #473): logins, 2FA, logout, OIDC,
 * access-denied. Deliberately smaller than AuditLogPanel above it in the same "Logs & audit" tab:
 * no CSV export, no free-text search, no per-actor local timezone (this table has none, unlike
 * AdminAuditLog) — just event type, resolved user, IP, time, and expandable raw metadata.
 */
export function SecurityAuditLogPanel() {
  const [entries, setEntries] = useState<SecurityAuditLogEntryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [eventType, setEventType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecurityAuditLog({ eventType: eventType || undefined, page, pageSize: PAGE_SIZE });
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to load security audit log."));
    } finally {
      setLoading(false);
    }
  }, [eventType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A fetch that resolves near-instantly (localhost, a warm cache) shouldn't flash "Loading…" on
  // and off - only a load that's genuinely taking a moment earns the loading copy.
  const showLoading = useDelayedLoading(loading);

  return (
    <Card
      title="Security audit log"
      actions={
        <select
          id="security-audit-log-event-type"
          name="security-audit-log-event-type"
          className="at-select"
          aria-label="Event type"
          value={eventType}
          onChange={(e) => {
            setEventType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All event types</option>
          {EVENT_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {eventLabel(type)}
            </option>
          ))}
        </select>
      }
      footer={
        !loading && !error && total > 0 ? (
          <div className="security-audit-log-footer">
            <span className="security-audit-log-footer__info">
              {`Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </span>
            <div className="security-audit-log-footer__pager">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span>
                Page {page} of {totalPages}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null
      }
    >
      {loading && showLoading && <p className="security-audit-log-status">Loading…</p>}

      {!loading && error && (
        <EmptyState
          title="Could not load security audit log"
          description={error}
          action={
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      )}

      {!loading && !error && entries.length === 0 && (
        <EmptyState
          icon={<i className="ti ti-shield-lock" aria-hidden="true" />}
          title={eventType ? "No matches" : "No security events yet"}
          description={
            eventType
              ? "Try a different event type, or clear the filter to see everything."
              : "Logins, 2FA checks, logout, OIDC, and access-denied events will appear here."
          }
        />
      )}

      {!loading && !error && entries.length > 0 && (
        <div className="security-audit-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th>User</th>
                <th>IP</th>
                <th>Time</th>
                <th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr>
                    <td>
                      <Badge variant={eventTone(entry.event_type)}>{eventLabel(entry.event_type)}</Badge>
                    </td>
                    <td>{userDisplay(entry)}</td>
                    <td>{entry.ip ?? "—"}</td>
                    <td>{formatUtcDateTime(entry.created_at)}</td>
                    <td>
                      {hasMetadata(entry) && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                        >
                          {expandedId === entry.id ? "Hide" : "Details"}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr>
                      <td colSpan={5}>
                        <pre className="security-audit-log-metadata">{JSON.stringify(entry.metadata, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
