import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, PageHeader } from "@admitto/ui";
import { ApiError, fetchCheckInEvents } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { formatEventCalendarDate } from "../utils/event-dates.js";

function formatDate(iso: string): string {
  return formatEventCalendarDate(iso);
}

export function CheckInEntryPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { reportApiError } = useConnectionState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchCheckInEvents();
        if (cancelled) return;
        if (list.length === 1) {
          navigate(`/operator/events/${list[0]!.id}/checkin`, { replace: true });
          return;
        }
        setEvents(list);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          reportApiError(err.status);
          setError("Failed to load check-in events.");
        } else {
          setError("Failed to load check-in events.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, reportApiError]);

  if (loading) {
    return <p>Loading check-in events…</p>;
  }

  if (error) {
    return <p className="text-error">{error}</p>;
  }

  if (events.length === 0) {
    return (
      <Card>
        <PageHeader title="Check-in" subtitle="No events with check-in access were found for your account." />
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Check-in" subtitle="Choose an event to open the check-in surface." />
      <div className="event-grid event-grid--touch">
        {events.map((event) => (
          <Card key={event.id} className="event-card event-card--touch">
            <h2 className="event-card__title">
              <Link to={`/operator/events/${event.id}/checkin`}>{event.title}</Link>
            </h2>
            <p className="event-card__meta">
              {formatDate(event.date)}
              {event.location ? ` · ${event.location}` : ""}
            </p>
          </Card>
        ))}
      </div>
    </>
  );
}
