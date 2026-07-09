import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Tabs } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { CreateEventModal } from "../events/CreateEventModal.js";
import { formatEventCalendarDate } from "../utils/event-dates.js";

type PickerTab = "active" | "archived";

/** Event picker for org admins and superadmins at `/admin` (no event context). */
export function EventsPickerPage() {
  const navigate = useNavigate();
  const { assignments } = useAuth();
  const showInstanceSettings = isSuperadmin(assignments);
  const [tab, setTab] = useState<PickerTab>("active");
  const [tabTouched, setTabTouched] = useState(false);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
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
        const message =
          err.status === 403 ? "You do not have access to the admin panel." : "Failed to load events.";
        setError(message);
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

  const gridClass =
    displayedEvents.length >= 4
      ? "event-grid event-grid--cols-3"
      : displayedEvents.length > 0
        ? "event-grid event-grid--cols-2"
        : "event-grid";

  useEffect(() => {
    if (!loading && !tabTouched && events.length > 0 && activeEvents.length === 0) {
      setTab("archived");
    }
  }, [loading, tabTouched, events.length, activeEvents.length]);

  const handleCreated = (event: EventDto) => {
    // Pass the event we already hold so EventLayout can render the shell
    // immediately instead of re-fetching the events list (#274).
    navigate(`/admin/events/${event.id}/attendees`, { state: { event } });
  };

  return (
    <div className="events-picker-screen">
      <PageHeader
        title="Events"
        subtitle="Select an event to manage its lifecycle."
        actions={
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
            New event
          </Button>
        }
      />

      <Tabs
        value={tab}
        onChange={(id) => {
          setTabTouched(true);
          setTab(id as PickerTab);
        }}
        tabs={[
          { id: "active", label: "Active events", count: activeEvents.length || undefined },
          { id: "archived", label: "Archived events", count: archivedEvents.length || undefined },
        ]}
      />

      {loading && (
        <div className="picker-loading" role="status">
          <Spinner label="Loading events" />
        </div>
      )}
      {!loading && error && (
        <EmptyState title="Could not load events" description={error} />
      )}

      {!loading && !error && tab === "active" && events.length === 0 && (
        <EmptyState
          icon={<i className="ti ti-calendar-off" />}
          title="No events yet"
          description="Create your first event to start managing attendees and check-in."
          action={
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              Create event
            </Button>
          }
        />
      )}

      {!loading && !error && displayedEvents.length === 0 && events.length > 0 && (
        <Card>
          <p>{tab === "archived" ? "No archived events." : "No active events in your scope."}</p>
          {tab === "active" && allEventsArchived && (
            <p className="at-hint">
              All events are archived. Open the{" "}
              <button type="button" className="picker-inline-link" onClick={() => setTab("archived")}>
                Archived events
              </button>{" "}
              tab to unarchive.
              {!showInstanceSettings && <> Contact your administrator if you need help.</>}
            </p>
          )}
        </Card>
      )}

      <div className={gridClass}>
        {displayedEvents.map((event) => {
          const cardBody = (
            <>
              <Badge
                variant={event.archived_at ? "neutral" : "ok"}
                className="event-card__status"
              >
                {event.archived_at ? "Archived" : "Active"}
              </Badge>
              <h2 className="event-card__title">{event.title}</h2>
              <p className="event-card__meta">
                <i className="ti ti-calendar" aria-hidden="true" />
                <span>{formatEventCalendarDate(event.date)}</span>
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
            </>
          );

          return (
            <Link
              key={event.id}
              to={`/admin/events/${event.id}/overview`}
              state={{ event }}
              className="event-card-link"
            >
              <Card className="event-card">{cardBody}</Card>
            </Link>
          );
        })}
      </div>

      <CreateEventModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
