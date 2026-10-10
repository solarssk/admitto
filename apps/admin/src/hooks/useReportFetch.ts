import { useState } from "react";
import { ApiError } from "../api/client.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { panelView, usePanelLoad, type PanelLoad } from "./usePanelLoad.js";

/** What the first read of a Reports screen (Event day, and each lazily loaded tab) does with a failure before it becomes the
 * error on screen: the connection state hears of it, a 401 hands the browser to the login page (the answer never comes, so no
 * error flashes up first), and whether the failure was a 403 is remembered, so that the error says the viewer has no access (the
 * Retry stays, since access can be granted meanwhile). It is set when the answer is in, never when a Retry starts, so the wording
 * of the error on screen does not change while the Retry runs. The failure is rethrown for `usePanelLoad`, which turns it into
 * the message (the server's own operator-safe wording, or the fallback). Extracted from the loads so their own cognitive
 * complexity stays low. */
export function failReportLoad(
  err: unknown,
  reportApiError: (status: number) => void,
  setAccessDenied: (denied: boolean) => void,
): Promise<never> {
  const status = err instanceof ApiError ? err.status : null;
  if (status !== null) {
    reportApiError(status);
    if (status === 401) {
      redirectToLogin();
      return new Promise<never>(() => {});
    }
  }
  setAccessDenied(status === 403);
  throw err;
}

export interface ReportFetch<T> {
  /** The report, once the first read has answered. */
  data: T | null;
  /** The placeholder, the error with its Retry, or the report. */
  view: "loading" | "error" | "ready";
  /** The first read's placeholder timing and its error (see `usePanelLoad`). */
  panel: PanelLoad;
  /** The failure was the server refusing access: the error says so instead of the server's words. */
  accessDenied: boolean;
}

/**
 * The first read of a Reports tab's own aggregate endpoint, on the loading standard (see `usePanelLoad`): nothing is drawn for
 * the first 200ms and a placeholder after that, "Taking longer than usual" after 8 seconds, and an error with a busy Retry after
 * 30 seconds or when it fails. It is one read for one event: a tab lives in a page that is keyed by the event, so another event
 * is another tab, never a new `eventId` for this one.
 */
export function useReportFetch<T>(
  fetchFn: (eventId: string, signal?: AbortSignal) => Promise<T>,
  eventId: string,
  genericErrorMessage: string,
): ReportFetch<T> {
  const { reportApiError } = useConnectionState();
  const [data, setData] = useState<T | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const panel = usePanelLoad({
    fetch: async (signal) => {
      try {
        return await fetchFn(eventId, signal);
      } catch (err) {
        return await failReportLoad(err, reportApiError, setAccessDenied);
      }
    },
    apply: setData,
    fallback: genericErrorMessage,
  });
  return { data, view: panelView(panel), panel, accessDenied };
}
