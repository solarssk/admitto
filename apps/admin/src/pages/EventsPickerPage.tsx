import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, PageHeader, Tabs } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents, unarchiveEvent } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { formatEventDate, formatEventDateTime } from "../utils/event-dates.js";

type PickerTab = "active" | "archived";

type UnarchiveTarget = { event: EventDto };

/** Event picker for org admins and superadmins at `/admin` (no event context). */
export function EventsPickerPage() {
  const { assignments } = useAuth();
  const showInstanceSettings = isSuperadmin(assignments);
  const canUnarchive = showInstanceSettings;
  const [tab, setTab] = useState<PickerTab>("active");
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unarchiveTarget, setUnarchiveTarget] = useState<UnarchiveTarget | null>(null);
  const [unarchiving, setUnarchiving] = useState(false);
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);
  const { reportApiError } = useConnectionState();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAdminEvents({ includeArchived: true, signal });
      if (signal?.aborted) return;
      setEvents(list);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setError(err.status === 403 ? "You do not have access to the admin panel." : "Failed to load events.");
      } else {
        setError("Failed to load events.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [reportApiError]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const activeEvents = useMemo(
    () => events.filter((e) => e.archived_at == null),
    [events],
  );
  const archivedEvents = useMemo(
    () => events.filter((e) => e.archived_at != null),
    [events],
  );
  const displayedEvents = tab === "archived" ? archivedEvents : activeEvents;
  const allEventsArchived = events.length > 0 && activeEvents.length === 0;

  const handleUnarchive = async () => {
    if (!unarchiveTarget) return;
    setUnarchiving(true);
    setUnarchiveError(null);
    try {
      await unarchiveEvent(unarchiveTarget.event.id);
      setUnarchiveTarget(null);
      await load();
    } catch (err) {
      setUnarchiveError(err instanceof ApiError ? err.message : "Failed to unarchive event.");
    } finally {
      setUnarchiving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Select an event to manage its lifecycle."
        actions={
          <>
            {showInstanceSettings && (
              <Link to="/admin/settings" className="at-btn at-btn--secondary">
                <span>Instance settings</span>
              </Link>
            )}
            <Button variant="secondary" disabled title="Coming in a future release">
              Create event
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as PickerTab)}
        tabs={[
          { id: "active", label: "Active events", count: activeEvents.length || undefined },
          { id: "archived", label: "Archived events", count: archivedEvents.length || undefined },
        ]}
      />

      {loading && <p className="picker-status">Loading events…</p>}
      {error && <p className="text-error">{error}</p>}
      {!loading && !error && displayedEvents.length === 0 && (
        <Card>
          <p>{tab === "archived" ? "No archived events." : "No active events in your scope."}</p>
          {tab === "active" && events.length === 0 && showInstanceSettings && (
            <p className="at-hint">
              Configure branding and mail transport in{" "}
              <Link to="/admin/settings">Instance settings</Link> while you wait for the first event.
            </p>
          )}
          {tab === "active" && allEventsArchived && (
            <p className="at-hint">
              All events are archived. Open the{" "}
              <button type="button" className="picker-inline-link" onClick={() => setTab("archived")}>
                Archived events
              </button>{" "}
              tab or unarchive via{" "}
              <Link to="/admin/settings">Instance settings</Link>.
            </p>
          )}
        </Card>
      )}
      <div className="event-grid">
        {displayedEvents.map((event) => (
          <Card key={event.id} className="event-card">
            <h2 className="event-card__title">
              <Link to={`/admin/events/${event.id}/overview`}>{event.title}</Link>
            </h2>
            <p className="event-card__meta">
              <i className="ti ti-calendar" aria-hidden="true" />
              <span>{formatEventDate(event.date)}</span>
              {event.location && (
                <>
                  <span aria-hidden="true">·</span>
                  <i className="ti ti-map-pin" aria-hidden="true" />
                  <span>{event.location}</span>
                </>
              )}
            </p>
            {event.attendee_count != null && (
              <div className="event-card__stats">
                <div className="event-card__stat">
                  <i className="ti ti-users" aria-hidden="true" />
                  <strong>{event.attendee_count}</strong>
                  <span>attendees</span>
                </div>
              </div>
            )}
            {event.archived_at && (
              <p className="event-card__archived">
                <Badge variant="neutral">Archived · read-only</Badge>
                <span>{formatEventDateTime(event.archived_at)}</span>
              </p>
            )}
            {tab === "archived" && canUnarchive && (
              <p className="event-card__actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setUnarchiveError(null);
                    setUnarchiveTarget({ event });
                  }}
                >
                  Unarchive
                </Button>
              </p>
            )}
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={!!unarchiveTarget}
        title="Unarchive event"
        message={
          unarchiveTarget
            ? `Restore "${unarchiveTarget.event.title}" to active events? Edits will be allowed again.`
            : ""
        }
        errorMessage={unarchiveError}
        confirmLabel="Unarchive"
        confirmVariant="primary"
        loading={unarchiving}
        onConfirm={() => void handleUnarchive()}
        onCancel={() => {
          if (!unarchiving) {
            setUnarchiveTarget(null);
            setUnarchiveError(null);
          }
        }}
      />
    </>
  );
}
