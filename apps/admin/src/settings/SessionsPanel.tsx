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
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { formatUtcDateTime } from "../utils/event-dates.js";

const BROWSER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/OPR\//, "Opera"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
];

const OS_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Windows/, "Windows"],
  [/Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
  [/Android/, "Android"],
  [/iPhone|iPad/, "iOS"],
];

function matchFirstPattern(ua: string, patterns: ReadonlyArray<readonly [RegExp, string]>): string | null {
  for (const [pattern, label] of patterns) {
    if (pattern.test(ua)) return label;
  }
  return null;
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  const browser = matchFirstPattern(ua, BROWSER_PATTERNS);
  const os = matchFirstPattern(ua, OS_PATTERNS);
  const parts = [browser, os].filter(Boolean);
  return parts.length ? parts.join(" / ") : ua.slice(0, 40);
}

function formatDate(iso: string): string {
  return formatUtcDateTime(iso);
}

type FilterValue = "all" | "admin" | "operator";

const FILTER_LABELS: Record<FilterValue, string> = {
  all: "All",
  admin: "Admins",
  operator: "Operators",
};

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
  const confirmDeviceSuffix = confirmTarget?.deviceLabel
    ? ` (${confirmTarget.deviceLabel})`
    : "";

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the "Loading…" text on and off faster than it can register as loading — show it only
  // once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

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
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        {loading && showLoading && <p className="sessions-status">Loading…</p>}

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
            ? `Revoke session for ${confirmTarget.userEmail}${confirmDeviceSuffix}? Last active ${formatDate(confirmTarget.lastSeenAt)}.`
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
