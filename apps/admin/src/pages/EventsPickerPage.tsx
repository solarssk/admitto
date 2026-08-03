import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button, EmptyState, PageHeader, Spinner, Tabs } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { EventCard, eventGridClassName } from "../components/EventCard.js";
import { CreateEventModal } from "../events/CreateEventModal.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";

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

  const gridClass = eventGridClassName(displayedEvents.length);

  // A fetch that resolves near-instantly (localhost, a warm cache) would
  // otherwise flash the spinner on and off faster than it can register as
  // "loading" — show it only once the fetch has genuinely taken a moment.
  const showLoadingSpinner = useDelayedLoading(loading);

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

      {loading && showLoadingSpinner && (
        <output className="picker-loading">
          <Spinner label="Loading events" />
        </output>
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

      {!loading && !error && tab === "archived" && displayedEvents.length === 0 && events.length > 0 && (
        <EmptyState
          icon={<i className="ti ti-archive-off" aria-hidden="true" />}
          title="No archived events"
          description="Events you archive will appear here."
        />
      )}

      {!loading && !error && tab === "active" && displayedEvents.length === 0 && allEventsArchived && (
        <EmptyState
          icon={<i className="ti ti-archive" aria-hidden="true" />}
          title="No active events"
          description={
            showInstanceSettings
              ? "All events are archived. Open the Archived events tab, then restore an event from Organisation settings → Event archiving (or Event settings)."
              : "All events are archived. Contact your administrator if you need help."
          }
          action={
            <Button type="button" variant="secondary" onClick={() => setTab("archived")}>
              View archived events
            </Button>
          }
        />
      )}

      <div className={gridClass}>
        {displayedEvents.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            href={`/admin/events/${event.id}/overview`}
            showStatusBadge
            showAttendeeCount
          />
        ))}
      </div>

      <CreateEventModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
