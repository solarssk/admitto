import { useMemo } from "react";
import { useOutletContext, useParams } from "react-router";
import { ApiError, fetchEventCustomFields } from "../api/client.js";
import type { EventDto } from "../api/types.js";
import { RefetchRegion } from "../components/RefetchRegion.js";
import { RetryEmptyState } from "../components/RetryEmptyState.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useCardLoad } from "../hooks/useCardLoad.js";
import { useListLoad } from "../hooks/useListLoad.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { EventCustomFieldsCard } from "../requirements/EventCustomFieldsCard.js";
import { RegistrationFieldsSkeleton } from "../requirements/RequirementsSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";

/** One event, one tab: a different `:eventId` is a fresh tab (its own read and dialogs), never the previous one's. */
export function RegistrationFieldsTab() {
  const { eventId } = useParams();
  if (!eventId) return <p>Missing event.</p>;
  return <RegistrationFieldsBody key={eventId} eventId={eventId} />;
}

/**
 * The questions guests answer: the event's custom attendee fields, the one place to add, edit, order and delete them (the
 * Requirements page reads the same list for the hints of its items), with the "On the form" switch and the arrows that order
 * them. It follows the loading standard of a card with a list (`useListLoad` and `useCardLoad`): a placeholder in the card's
 * own shape for the first read, an error with a busy Retry that stays on screen until the answer is in, and the card kept,
 * blocked and dimmed, while the read that follows an add, an edit or a delete runs. What a switch or an arrow has just saved
 * is shown at once, from the server's answer.
 */
function RegistrationFieldsBody({ eventId }: Readonly<{ eventId: string }>) {
  const { event } = useOutletContext<{ event: EventDto }>();
  const { reportApiError } = useConnectionState();
  // A failure is told to the connection state when the answer is in, never when a Retry starts, so the wording of the error on
  // screen does not change while a Retry runs; a 401 hands the browser to the login page instead (`orLoginRedirect`, once the
  // connection state has heard of it), and no error flashes up first.
  const fetchFields = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await fetchEventCustomFields(eventId, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const list = useListLoad({ fetcher: fetchFields, fallback: "Could not load attendee fields." });
  const card = useCardLoad(list);

  if (!card.gate.showContent) return <RegistrationFieldsSkeleton held={!card.gate.showIndicator} slow={card.slow} />;
  if (card.failure.error) {
    return (
      <RetryEmptyState
        title="Could not load attendee fields"
        message={card.failure.error}
        retrying={card.failure.retrying}
        onRetry={card.failure.retry}
      />
    );
  }
  assertPresent(list.data);
  return (
    // What replaces the placeholder fades in.
    <div className="at-fade-in">
      <RefetchRegion refreshing={list.refreshing} label="Refreshing attendee fields">
        <EventCustomFieldsCard
          eventId={eventId}
          event={event}
          fields={list.data}
          // A field that was added, changed or deleted is somewhere in the list that the tab cannot tell, so a read that fails
          // replaces the card with the error (it may be wrong); the card stays, blocked and dimmed, while it runs.
          onChanged={() => void list.reload({ keepRowsOnFailure: false })}
          onUpdated={(change) => list.update(change)}
        />
      </RefetchRegion>
    </div>
  );
}
