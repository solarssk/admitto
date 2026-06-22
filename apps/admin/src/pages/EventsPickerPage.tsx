import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, PageHeader, Tabs } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";

type PickerTab = "active" | "archived";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatArchivedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Event picker for org admins and superadmins at `/admin` (no event context). */
export function EventsPickerPage() {
  const { assignments } = useAuth();
  const showInstanceSettings = isSuperadmin(assignments);
  const [tab, setTab] = useState<PickerTab>("active");
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { reportApiError } = useConnectionState();

  const load = useCallback(async (pickerTab: PickerTab) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAdminEvents({
        includeArchived: pickerTab === "archived",
      });
      setEvents(list);
    } catch (err) {
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setError(err.status === 403 ? "You do not have access to the admin panel." : "Failed to load events.");
      } else {
        setError("Failed to load events.");
      }
    } finally {
      setLoading(false);
    }
  }, [reportApiError]);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  const displayedEvents = useMemo(() => {
    if (tab === "archived") {
      return events.filter((e) => e.archived_at != null);
    }
    return events;
  }, [events, tab]);

  const emptyMessage =
    tab === "archived" ? "No archived events." : "No events in your scope yet.";

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
          { id: "active", label: "Active events" },
          { id: "archived", label: "Archived events" },
        ]}
      />

      {loading && <p className="picker-status">Loading events…</p>}
      {error && <p className="text-error">{error}</p>}
      {!loading && !error && displayedEvents.length === 0 && (
        <Card>
          <p>{emptyMessage}</p>
          {tab === "active" && showInstanceSettings && (
            <p className="at-hint">
              Configure branding and mail transport in{" "}
              <Link to="/admin/settings">Instance settings</Link> while you wait for the first event.
            </p>
          )}
        </Card>
      )}
      <div className="event-grid">
        {displayedEvents.map((event) => (
          <Card key={event.id} className="event-card">
            <h2 className="event-card__title">
              {tab === "archived" ? (
                <span>{event.title}</span>
              ) : (
                <Link to={`/admin/events/${event.id}/overview`}>{event.title}</Link>
              )}
            </h2>
            <p className="event-card__meta">
              {formatDate(event.date)}
              {event.location ? ` · ${event.location}` : ""}
            </p>
            {event.archived_at && (
              <p className="event-card__archived">
                <Badge variant="neutral">Archived</Badge>
                <span> {formatArchivedAt(event.archived_at)}</span>
              </p>
            )}
            {event.attendee_count != null && (
              <p className="event-card__count">{event.attendee_count} attendees</p>
            )}
            {tab === "archived" && (
              <p className="event-card__hint">
                <Link to={`/admin/events/${event.id}/overview`}>View read-only</Link>
              </p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
