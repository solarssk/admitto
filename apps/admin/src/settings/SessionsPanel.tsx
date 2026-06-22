import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@admitto/ui";
import {
  ApiError,
  fetchAdminEvents,
  fetchSessions,
  revokeAllOperatorSessions,
  revokeSessionById,
} from "../api/client.js";
import type { EventDto, SessionListDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

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
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

type FilterValue = "all" | "admin" | "operator";

/** Settings panel — lists active staff sessions, per-session revoke, and bulk operator-session revoke by event. */
export function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionListDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [confirmTarget, setConfirmTarget] = useState<SessionListDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [events, setEvents] = useState<EventDto[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkRevoking, setBulkRevoking] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSessions();
      setSessions(data.sessions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    fetchAdminEvents()
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
    setRevokeError(null);
    try {
      await revokeSessionById(confirmTarget.id);
      setConfirmTarget(null);
      await load();
    } catch (err) {
      setRevokeError(err instanceof ApiError ? err.message : "Failed to revoke session.");
    } finally {
      setRevoking(false);
    }
  };

  const handleBulkRevoke = async () => {
    if (!selectedEventId) return;
    setBulkRevoking(true);
    setBulkError(null);
    setBulkResult(null);
    try {
      const { revokedCount } = await revokeAllOperatorSessions(selectedEventId);
      setBulkResult(`Revoked ${revokedCount} operator session${revokedCount === 1 ? "" : "s"}.`);
      setBulkConfirmOpen(false);
      await load();
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : "Failed to revoke sessions.");
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

        {revokeError && <p className="sessions-error">{revokeError}</p>}
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
              setBulkResult(null);
              setBulkError(null);
            }}
          >
            <option value="">Select event…</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
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
        {bulkResult && <p className="sessions-success">{bulkResult}</p>}
        {bulkError && <p className="sessions-error">{bulkError}</p>}
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
