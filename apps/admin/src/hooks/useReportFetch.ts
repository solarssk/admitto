import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { useDelayedLoading } from "./useDelayedLoading.js";

/** Abort-safe fetch lifecycle for a Reports tab's own aggregate endpoint: abort-then-refetch on
 * every call (so a rapid retry or an eventId change never lets a stale response land after a
 * newer one), ApiError mapping (403 -> a fixed access message, everything else ->
 * operatorApiErrorMessage with the caller's own fallback text), and the delayed-loading skeleton
 * gate - identical boilerplate WalletsReportsTab.tsx and CustomFieldsReportsTab.tsx both need for
 * their own "load one report object for this event, retry on demand" shape (SonarCloud new-code
 * duplication flag on PR #1185, same reasoning as reclaim-stale-admin-jobs-by-type.ts). */
export function useReportFetch<T>(
  fetchFn: (eventId: string, signal?: AbortSignal) => Promise<T>,
  eventId: string,
  genericErrorMessage: string,
): { data: T | null; loading: boolean; error: string | null; showLoadingSkeleton: boolean; retry: () => void } {
  const { reportApiError } = useConnectionState();
  const abortRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    // ReportsPage doesn't remount on an eventId-only in-SPA navigation (its own reconcile-timer
    // comment explains why) - without this, switching events while this tab is the active/sticky
    // one would keep rendering the *previous* event's chart data until the new fetch resolves,
    // since `data` only otherwise changes on a successful response.
    setData(null);
    try {
      const report = await fetchFn(eventId, ac.signal);
      if (ac.signal.aborted) return;
      setData(report);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setData(null);
      if (err instanceof ApiError) {
        reportApiError(err.status);
        setError(
          hasApiErrorCode(err, "forbidden")
            ? "You do not have access to this event."
            : operatorApiErrorMessage(err, "Request failed."),
        );
      } else {
        setError(genericErrorMessage);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId, fetchFn, reportApiError, genericErrorMessage]);

  useEffect(() => {
    void loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  const showLoadingSkeleton = useDelayedLoading(loading);

  return { data, loading, error, showLoadingSkeleton, retry: () => void loadData() };
}
