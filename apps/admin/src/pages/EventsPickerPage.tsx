import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, PageHeader } from "@admitto/ui";
import { useAuth } from "../auth/AuthProvider.js";
import { isSuperadmin } from "../auth/capabilities.js";
import { ApiError, fetchAdminEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Event picker for org admins and superadmins at `/admin` (no event context). */
export function EventsPickerPage() {
  const { assignments } = useAuth();
  const showInstanceSettings = isSuperadmin(assignments);
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { reportApiError } = useConnectionState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchAdminEvents();
        if (!cancelled) setEvents(list);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          setError(err.status === 403 ? "You do not have access to the admin panel." : "Failed to load events.");
        } else {
          setError("Failed to load events.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportApiError]);

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
      {loading && <p>Loading events…</p>}
      {error && <p className="text-error">{error}</p>}
      {!loading && !error && events.length === 0 && (
        <Card>
          <p>No events in your scope yet.</p>
          {showInstanceSettings && (
            <p className="at-hint">
              Configure branding and mail transport in{" "}
              <Link to="/admin/settings">Instance settings</Link> while you wait for the first event.
            </p>
          )}
        </Card>
      )}
      <div className="event-grid">
        {events.map((event) => (
          <Card key={event.id} className="event-card">
            <h2 className="event-card__title">
              <Link to={`/admin/events/${event.id}/overview`}>{event.title}</Link>
            </h2>
            <p className="event-card__meta">
              {formatDate(event.date)}
              {event.location ? ` · ${event.location}` : ""}
            </p>
            {event.attendee_count != null && (
              <p className="event-card__count">{event.attendee_count} attendees</p>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
