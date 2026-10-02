import { useEffect, useState } from "react";
import { fetchAdminEvents } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { loadWithTimeout } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE } from "../utils/loading-timing.js";
import { useRetry } from "./useRetry.js";

/**
 * The events (archived ones too) that a filter or a picker offers. A failure is not an empty list: it says so
 * (`error`) and has a Retry (`retry`, busy for at least 400ms as `retrying`) that reruns this request only. The
 * request has the 30 second limit and is abandoned when the page is left.
 */
export function useEventOptions() {
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { token, retry, begin, end, busy } = useRetry();

  useEffect(() => {
    const controller = new AbortController();
    const limit = loadWithTimeout(controller.signal);
    // A retry keeps its error, and the busy Retry next to it, on screen until the answer is in.
    if (!begin()) setError(null);
    fetchAdminEvents({ includeArchived: true, signal: limit.signal })
      .then((list) => {
        if (controller.signal.aborted) return;
        setEvents(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(limit.timedOut() ? `Could not load events. ${LOAD_TIMEOUT_MESSAGE}` : operatorApiErrorMessage(err, "Could not load events."));
      })
      .finally(() => {
        limit.done();
        if (!controller.signal.aborted) end();
      });
    return () => controller.abort();
  }, [token, begin, end]);

  return { events, error, retry, retrying: busy };
}
