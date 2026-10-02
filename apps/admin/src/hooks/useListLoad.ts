import { useCallback, useEffect, useRef, useState } from "react";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { loadWithTimeout, rejectOnAbort, type LoadTimeout } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE } from "../utils/loading-timing.js";

export interface ListLoadOptions<T> {
  /**
   * Reads the list for the current query. Memoise it (`useCallback`) over everything the query depends on: a new
   * function is a new query (a search, a filter, another page), and the previous one is abandoned.
   */
  fetcher: (signal: AbortSignal) => Promise<T>;
  /** The text for a failure the server gave no text for. */
  fallback: string;
  /** False when there is nothing to load for this viewer: nothing runs, and nothing is shown loading. */
  enabled?: boolean;
  /** Called with the newest answer, and only with that. */
  onData?: (data: T) => void;
}

export interface ListLoad<T> {
  /** The newest answer, `null` before the first one. It stays while a later query is on its way. */
  data: T | null;
  /** Nothing to show yet: the first load, or the load after a failed one. The placeholder takes the list's place. */
  loading: boolean;
  /** An answer is on screen and a newer one is on its way (another query, or `reload`): keep it, block it, dim it. */
  refreshing: boolean;
  /** The list could not be loaded, and it replaces the list. `reload` is its Retry, and starts as a first load. */
  error: string | null;
  /** A `reload` of the same query failed (after an action): the list stays, and may be older than the server's. */
  refreshError: string | null;
  /**
   * The same query again, after an action. Resolves when the answer, or the failure, is in. When it fails, the rows
   * stay with a warning (`refreshError`), unless the action has changed them in a way the page cannot tell
   * (`keepRowsOnFailure: false`): then the rows, which may be wrong, are replaced by the error, with the refresh
   * blocking them until it ends.
   */
  reload: (options?: { keepRowsOnFailure?: boolean }) => Promise<void>;
  /**
   * Applies what the server has just confirmed to the answer on screen (a saved row, a deleted one), and reports it
   * like an answer (`onData`). Call it before `reload`, so a refresh that fails does not make a saved change look lost:
   * the `reload` supersedes any request still on its way. Does nothing before the first answer.
   */
  update: (change: (data: T) => T) => void;
}

const REFRESH_FAILED = "Could not refresh this list, so it may show older details.";
const REFRESH_HINT = "Check your connection and try again.";

/** What one run reads and writes. Everything in it is stable for one `fetcher`, so a run needs no closure of its own. */
interface RunContext<T> {
  enabled: boolean;
  fetcher: (signal: AbortSignal) => Promise<T>;
  fallback: string;
  loadedRef: { current: boolean };
  /** The fetcher whose answer is the data on screen: the data answers the current query only when it is `fetcher`. */
  answeredRef: { current: ((signal: AbortSignal) => Promise<T>) | null };
  requestRef: { current: number };
  onDataRef: { current: ((data: T) => void) | undefined };
  setData: (data: T) => void;
  setLoading: (value: boolean) => void;
  setRefreshing: (value: boolean) => void;
  setError: (value: string | null) => void;
  setRefreshError: (value: string | null) => void;
}

function failureMessage(limit: LoadTimeout, err: unknown, fallback: string): string {
  return limit.timedOut() ? LOAD_TIMEOUT_MESSAGE : operatorApiErrorMessage(err, fallback);
}

/** One request of the list. Kept out of the hook so its branches are not nested a level deeper in a callback. */
async function runListLoad<T>(ctx: RunContext<T>, kind: "query" | "reload", signal?: AbortSignal, keepRows = true): Promise<void> {
  if (!ctx.enabled) {
    // Nothing to load for this viewer. A run that was under way when this became true was abandoned by the effect's
    // cleanup, and does not reset the flags itself.
    ctx.setLoading(false);
    ctx.setRefreshing(false);
    return;
  }
  if (ctx.loadedRef.current) ctx.setRefreshing(true);
  else ctx.setLoading(true);
  ctx.setError(null);
  const mine = ++ctx.requestRef.current;
  const superseded = () => signal?.aborted || mine !== ctx.requestRef.current;
  const limit = loadWithTimeout(signal);
  try {
    const next = await rejectOnAbort(ctx.fetcher(limit.signal), limit.signal);
    if (superseded()) return;
    ctx.setData(next);
    ctx.setRefreshError(null);
    ctx.onDataRef.current?.(next);
    // The answer counts as taken once its consumer has taken it: if `onData` throws, this is a failed load (below), and a
    // Retry of it is not a refresh of a list that is on screen.
    ctx.loadedRef.current = true;
    ctx.answeredRef.current = ctx.fetcher;
  } catch (err) {
    if (superseded()) return;
    // A reload of the list on screen keeps it: the warning says it may be older, with a hint instead of "could not load".
    // Only when what is on screen answers this query: a reload that took over from a changed query still on its way
    // finds the rows of the previous query, and those no longer answer what was asked.
    const keepsList = kind === "reload" && keepRows && ctx.loadedRef.current && ctx.answeredRef.current === ctx.fetcher;
    const message = failureMessage(limit, err, keepsList ? REFRESH_HINT : ctx.fallback);
    if (keepsList) {
      ctx.setRefreshError(`${REFRESH_FAILED} ${message}`);
    } else {
      ctx.loadedRef.current = false;
      // The rows are gone with this error, so an earlier "may show older details" warning about them has nothing to say.
      ctx.setRefreshError(null);
      ctx.setError(message);
    }
  } finally {
    limit.done();
    if (!superseded()) {
      ctx.setLoading(false);
      ctx.setRefreshing(false);
    }
  }
}

/**
 * A list that follows the loading standard (AGENTS.md "Admin SPA loading and busy states"). Only the first load
 * (or the load after a failed one) leaves nothing to show; every later query or `reload` keeps the answer that is
 * on screen, so a table is never unmounted because a refetch started. Each request has the 30 second limit
 * (`loadWithTimeout`), and an answer that is no longer the latest request, success or failure, is dropped, so an
 * older list never replaces a newer one. A failed `reload` keeps the list and says so (`refreshError`); a failed
 * query replaces it with `error`, because what is on screen no longer answers what was asked.
 */
export function useListLoad<T>({ fetcher, fallback, enabled = true, onData }: ListLoadOptions<T>): ListLoad<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const dataRef = useRef<T | null>(null);
  const answeredRef = useRef<((signal: AbortSignal) => Promise<T>) | null>(null);
  const requestRef = useRef(0);
  // Aborted when the query changes or the page is left, so a reload started by an action follows the same life.
  const lifeRef = useRef<AbortController | null>(null);
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  });

  const setAnswer = useCallback((next: T) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const run = useCallback(
    (kind: "query" | "reload", signal?: AbortSignal, keepRows?: boolean) =>
      runListLoad(
        { enabled, fetcher, fallback, loadedRef, answeredRef, requestRef, onDataRef, setData: setAnswer, setLoading, setRefreshing, setError, setRefreshError },
        kind,
        signal,
        keepRows,
      ),
    [enabled, fetcher, fallback, setAnswer],
  );

  useEffect(() => {
    const controller = new AbortController();
    lifeRef.current = controller;
    void run("query", controller.signal);
    return () => controller.abort();
  }, [run]);

  // A handler made for an older render (a dialog that finishes after an await) must reload what the list shows now,
  // not the query it was made for.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const reload = useCallback(
    (options?: { keepRowsOnFailure?: boolean }) => runRef.current("reload", lifeRef.current?.signal, options?.keepRowsOnFailure),
    [],
  );

  const update = useCallback(
    (change: (current: T) => T) => {
      const current = dataRef.current;
      if (current === null) return;
      const next = change(current);
      setAnswer(next);
      onDataRef.current?.(next);
    },
    [setAnswer],
  );

  return { data, loading, refreshing, error, refreshError, reload, update };
}
