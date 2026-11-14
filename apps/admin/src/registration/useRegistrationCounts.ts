import { useCallback } from "react";
import { ApiError, fetchRegistrationCounts } from "../api/client.js";
import type { RegistrationCountsDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useListLoad, type ListLoad } from "../hooks/useListLoad.js";
import { redirectToLogin } from "../identity/loginRedirect.js";

/**
 * How many requests an event has in each state. The tab strip of the Registration page shows `needs_decision` whichever tab is
 * open, and the Requests tab shows the number of each state in its filter. The numbers are an extra: a read that fails leaves
 * the strip and the filter without them and says nothing on the page (the tab's own list has the error and its Retry), and
 * `poll` asks again without a sign of it. With no event nothing is read.
 */
export function useRegistrationCounts(eventId: string | undefined): ListLoad<RegistrationCountsDto> {
  const { reportApiError } = useConnectionState();
  const fetchCounts = useCallback(
    async (signal: AbortSignal, context?: { poll: boolean }): Promise<RegistrationCountsDto> => {
      try {
        return await fetchRegistrationCounts(eventId ?? "", signal);
      } catch (err) {
        // A missed tick says nothing (the connection heartbeat sees a session that ended); a read somebody waits for does: the
        // connection state hears that the session ended and the browser goes to the login page, with no error flashing up first.
        if (!context?.poll && err instanceof ApiError && err.status === 401) {
          reportApiError(401);
          redirectToLogin();
          return new Promise<never>(() => {});
        }
        throw err;
      }
    },
    [eventId, reportApiError],
  );
  // A failed read that somebody waits for is told to the connection state (a 5xx says the server is unavailable); a missed tick is not.
  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) reportApiError(err.status);
    },
    [reportApiError],
  );
  return useListLoad({ fetcher: fetchCounts, fallback: "Could not load the request numbers.", enabled: Boolean(eventId), onError });
}
