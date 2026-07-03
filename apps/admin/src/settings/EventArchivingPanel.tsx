import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, useToast } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { ApiError, archiveEvent, fetchAdminEvents, unarchiveEvent } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { formatEventCalendarDate, formatUtcDateTime } from "../utils/event-dates.js";

type ConfirmAction = { type: "archive" | "unarchive"; event: EventDto };

/** Settings panel — archive/unarchive events (superadmin-only section). */
export function EventArchivingPanel() {
  const { addToast } = useToast();
  const [events, setEvents] = useState<EventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAdminEvents({ includeArchived: true, signal });
      if (signal?.aborted) return;
      setEvents(list);
    } catch (err) {
      if (signal?.aborted) return;
      const message = err instanceof ApiError ? err.message : "Failed to load events.";
      setError(message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activeEvents = useMemo(
    () => events.filter((e) => !e.archived_at),
    [events],
  );
  const archivedEvents = useMemo(
    () => events.filter((e) => e.archived_at),
    [events],
  );

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setActing(true);
    setActionError(null);
    try {
      if (confirmAction.type === "archive") {
        await archiveEvent(confirmAction.event.id);
        addToast("Event archived.", "success");
      } else {
        await unarchiveEvent(confirmAction.event.id);
        addToast("Event unarchived.", "success");
      }
      setConfirmAction(null);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setActing(false);
    }
  };

  const renderEventTable = (
    rows: EventDto[],
    mode: "active" | "archived",
    emptyMessage: string,
  ) => {
    if (rows.length === 0) {
      return <p className="archiving-status">{emptyMessage}</p>;
    }

    return (
      <div className="archiving-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              {mode === "archived" && <th>Archived</th>}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => (
              <tr key={event.id}>
                <td>
                  <div>{event.title}</div>
                  <div className="archiving-subdued">{event.slug}</div>
                </td>
                <td>{formatEventCalendarDate(event.date)}</td>
                {mode === "archived" && (
                  <td>{event.archived_at ? formatUtcDateTime(event.archived_at) : "—"}</td>
                )}
                <td>
                  {mode === "active" ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => setConfirmAction({ type: "archive", event })}
                    >
                      Archive
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setConfirmAction({ type: "unarchive", event })}
                    >
                      Unarchive
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <Card title="Event archiving">
        <p className="archiving-hint">
          Archive completed events to hide them from default lists and make them read-only. Data is
          preserved.
        </p>
        <p className="archiving-note">
          Data deletion is a separate ops step (v1.0).
        </p>

        {loading && <p className="archiving-status">Loading…</p>}

        {!loading && error && (
          <div className="archiving-status">
            <p className="archiving-error">{error}</p>
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && (
          <>
            <h3 className="archiving-section-title">Active</h3>
            {renderEventTable(activeEvents, "active", "No active events.")}

            <h3 className="archiving-section-title">Archived</h3>
            {renderEventTable(archivedEvents, "archived", "No archived events.")}
          </>
        )}

      </Card>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.type === "archive" ? "Archive event" : "Unarchive event"}
        message={
          confirmAction?.type === "archive"
            ? "This event will be hidden and read-only. Data is preserved. A superadmin can unarchive later."
            : confirmAction
              ? `Restore "${confirmAction.event.title}" to active events? Edits will be allowed again.`
              : ""
        }
        confirmLabel={confirmAction?.type === "archive" ? "Archive" : "Unarchive"}
        confirmVariant={confirmAction?.type === "archive" ? "danger" : "primary"}
        loading={acting}
        errorMessage={actionError}
        onConfirm={() => void handleConfirm()}
        onCancel={() => {
          if (!acting) {
            setConfirmAction(null);
            setActionError(null);
          }
        }}
      />
    </>
  );
}
