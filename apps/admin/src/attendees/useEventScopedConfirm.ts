import { useRef, useState } from "react";

/** The confirm dialog behind an event-wide action in the Attendees header ("Push updates",
 * "Refresh status"). Kept out of AttendeesPage itself (its own cognitive complexity is already at
 * the SonarCloud limit).
 *
 * AttendeesPage stays mounted when the route's `:eventId` changes, so plain open/error state would
 * leave a dialog opened on event A showing on event B, and its confirm handler would then queue the
 * job for B, an event the operator never confirmed. The confirmation therefore records the event it
 * was opened on: it is dropped as soon as the route event differs (and does not come back when the
 * operator returns to that event), an error shown on it goes with it, and `target()` hands the
 * confirm handler that captured id only while the page is still on that event. */
export function useEventScopedConfirm(eventId: string | undefined) {
  const [confirmation, setConfirmation] = useState<{ eventId: string; error: string | null } | null>(null);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;

  // Adjusting state during render is React's documented way to reset it when a prop changes; the
  // condition turns false on the re-render it triggers, so it cannot loop.
  if (confirmation !== null && confirmation.eventId !== eventId) setConfirmation(null);

  return {
    open: confirmation !== null,
    error: confirmation?.error ?? null,
    /** Opens the confirmation for the event the page is on now. */
    request: () => {
      if (eventId) setConfirmation({ eventId, error: null });
    },
    /** Closes the confirmation and clears its error. */
    close: () => setConfirmation(null),
    /** Sets or clears the inline error shown on the open confirmation. */
    setError: (message: string | null) => setConfirmation((prev) => (prev === null ? prev : { ...prev, error: message })),
    /** The event the open confirmation was opened on, or null when there is none for the event the
     * page is on right now (also for a handler captured before a navigation). The confirm handler
     * acts on this id only. */
    target: () => (confirmation !== null && confirmation.eventId === eventIdRef.current ? confirmation.eventId : null),
  };
}
