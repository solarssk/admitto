import { useCallback } from "react";
import { ApiError, fetchRegistrationCounts, fetchRegistrationSettings } from "../api/client.js";
import type { RegistrationCountsDto, RegistrationSettingsDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useListLoad, type ListLoad } from "../hooks/useListLoad.js";
import { redirectToLogin } from "../identity/loginRedirect.js";

/**
 * An extra of the Registration page that is read once for the whole page, whichever tab is open: a read that fails says nothing
 * on the page (the tab's own read has the error and its Retry), and `poll` asks again without a sign of it. With no event nothing
 * is read.
 */
function useEventExtra<T>(
  eventId: string | undefined,
  read: (eventId: string, signal: AbortSignal) => Promise<T>,
  fallback: string,
  onData?: (data: T) => void,
): ListLoad<T> {
  const { reportApiError } = useConnectionState();
  const fetchExtra = useCallback(
    async (signal: AbortSignal, context?: { poll: boolean }): Promise<T> => {
      try {
        // The read runs only while there is an event (`enabled`), so it is never asked for none.
        return await read(eventId as string, signal);
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
    [eventId, read, reportApiError],
  );
  // A failed read that somebody waits for is told to the connection state (a 5xx says the server is unavailable); a missed tick is not.
  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) reportApiError(err.status);
    },
    [reportApiError],
  );
  return useListLoad({ fetcher: fetchExtra, fallback, enabled: Boolean(eventId), onData, onError });
}

/**
 * How many requests an event has in each state. The tab strip of the Registration page shows `needs_decision` whichever tab is
 * open, and the Requests tab shows the number of each state in its filter. The numbers are an extra (see `useEventExtra`).
 */
export function useRegistrationCounts(eventId: string | undefined): ListLoad<RegistrationCountsDto> {
  return useEventExtra(eventId, fetchRegistrationCounts, "Could not load the request numbers.");
}

/**
 * The settings of the registration of the event, for the switch in the header and the number on the Checklist tab (an extra, see
 * `useEventExtra`). `onData` hears each answer. With no event nothing is read: the page passes none while the Checklist tab, which reads
 * the settings itself and tells the page, is open.
 */
export function useRegistrationSettings(eventId: string | undefined, onData: (settings: RegistrationSettingsDto) => void): ListLoad<RegistrationSettingsDto> {
  return useEventExtra(eventId, fetchRegistrationSettings, "Could not load the registration settings.", onData);
}
