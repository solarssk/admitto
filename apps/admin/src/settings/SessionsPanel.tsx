import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, useToast } from "@admitto/ui";
import {
  fetchAdminEvents,
  fetchSessions,
  revokeAllOperatorSessions,
  revokeSessionById,
} from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, SessionListDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatUtcDateTime } from "../utils/event-dates.js";

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser =
    /Edg\//.test(ua)
      ? "Edge"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const os =
    /Windows/.test(ua)
      ? "Windows"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Linux/.test(ua)
          ? "Linux"
          : /Android/.test(ua)
            ? "Android"
            : /iPhone|iPad/.test(ua)
              ? "iOS"
              : null;
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}

function formatDate(iso: string): string {
  return formatUtcDateTime(iso);
}

type FilterValue = "all" | "admin" | "operator";

/** Settings panel — lists active staff sessions, per-session revoke, and bulk operator-session revoke by event. */
export function SessionsPanel() {
  const { addToast } = useToast();
  const [sessions, setSessions] = useState<SessionListDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [confirmTarget, setConfirmTarget] = useState<SessionListDto | null>(null);
  const [revoking, setRevoking] = useState(false);

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
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to load sessions.");
      setError(message);
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

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

  return (
    <>
      <Card title="Sessions">
        <div className="sessions-filter">
          {(["all", "admin", "operator"] as FilterValue[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`sessions-filter__btn${filter === f ? " sessions-filter__btn--active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "admin" ? "Admins" : "Operators"}
            </button>
          ))}
        </div>

        {loading && <p className="sessions-status">Loading…</p>}

        {!loading && error && (
          <div className="sessions-status">
            <p>{error}</p>
            <Button type="button" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && displayed.length === 0 && (
          <p className="sessions-status">No active sessions.</p>
        )}

        {!loading && !error && displayed.length > 0 && (
          <div className="sessions-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Device</th>
                  <th>IP</th>
                  <th>Logged in</th>
                  <th>Last active</th>
                  <th>Auth</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div>{s.userEmail}</div>
                      {s.userDisplayName && (
                        <div className="sessions-subdued">{s.userDisplayName}</div>
                      )}
                    </td>
                    <td>
                      <Badge variant="neutral">{s.role}</Badge>
                      {s.isCurrent && (
                        <Badge variant="neutral" className="sessions-current-badge">
                          Current session
                        </Badge>
                      )}
                    </td>
                    <td title={s.userAgent ?? undefined}>
                      {s.deviceLabel
                        ? s.deviceLabel
                        : parseUserAgent(s.userAgent)}
                    </td>
                    <td>{s.ip ?? "—"}</td>
                    <td>{formatDate(s.loginAt)}</td>
                    <td>{formatDate(s.lastSeenAt)}</td>
                    <td>{s.authMethod === "oidc" ? "OIDC" : "Local"}</td>
                    <td>
                      {s.isCurrent ? (
                        <Button
                          type="button"
                          variant="danger"
                          disabled
                          title="You cannot revoke your own session"
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => setConfirmTarget(s)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </Card>

      <Card title="Bulk revoke operator sessions">
        <p className="sessions-hint">
          Immediately end all active operator sessions for a specific event.
        </p>
        <div className="sessions-bulk-row">
          <select
            className="at-select"
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
            ? `Revoke session for ${confirmTarget.userEmail}` +
              (confirmTarget.deviceLabel ? ` (${confirmTarget.deviceLabel})` : "") +
              `? Last active ${formatDate(confirmTarget.lastSeenAt)}.`
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

      <ConfirmDialog
        open={bulkConfirmOpen}
        title="Revoke all operator sessions"
        message={
          selectedEvent
            ? `This will immediately end all active operator sessions for "${selectedEvent.title}". This cannot be undone.`
            : "This will immediately end all active operator sessions for the selected event."
        }
        confirmLabel="Revoke all"
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
