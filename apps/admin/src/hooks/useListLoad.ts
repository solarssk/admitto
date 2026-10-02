import { useCallback, useEffect, useRef, useState } from "react";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { loadWithTimeout, rejectOnAbort, type LoadTimeout } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE } from "../utils/loading-timing.js";

/**
 * How a list is read: the signal that ends the request, and, for a tick of `poll`, `{ poll: true }`, for a fetcher that has
 * something to do only for a read somebody waits for (handing the browser to the login page on a 401, which a missed tick
 * must not do).
 */
export type ListFetcher<T> = (signal: AbortSignal, context?: { poll: boolean }) => Promise<T>;

export interface ListLoadOptions<T> {
  /**
   * Reads the list for the current query. Memoise it (`useCallback`) over everything the query depends on: a new
   * function is a new query (a search, a filter, another page), and the previous one is abandoned. A tick of `poll` passes
   * `{ poll: true }` as the second argument, for a fetcher that has something to do only for a read somebody waits for
   * (handing the browser to the login page on a 401, which a missed tick must not do).
   */
  fetcher: ListFetcher<T>;
  /** The text for a failure the server gave no text for. */
  fallback: string;
  /** False when there is nothing to load for this viewer: nothing runs, and nothing is shown loading. */
  enabled?: boolean;
  /** Called with the newest answer, and only with that. */
  onData?: (data: T) => void;
  /**
   * Called with the error of a load, a changed query or a `reload` that somebody waits for and that failed, not with the
   * failure of a tick of `poll` and not with one that was abandoned. For what the page does besides saying it, such as
   * telling the connection state.
   */
  onError?: (error: unknown) => void;
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
  /** Whether the list is read at all (the `enabled` option). One that is not (its tab is closed) has nothing under way, which is not a wait. */
  enabled: boolean;
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
  /**
   * One tick of a live list: the same query again, with no sign of it on screen (no `refreshing`, nothing dimmed). It
   * starts nothing while another request of the list is on its way (a tick never takes over from a search, a page or a
   * Retry that somebody is waiting for), nor while the previous tick is (a slow answer is applied when it comes, never
   * dropped for a newer tick, and requests do not pile up), a tick that fails changes nothing (a missed one is not an error
   * over rows that are on screen, and the next one tries again), and an answer replaces the one on screen, also the error of
   * a load that failed, so a list that could not be read comes back by itself. Call it from an interval while the list is live.
   */
  poll: () => Promise<void>;
}

const REFRESH_FAILED = "Could not refresh this list, so it may show older details.";
const REFRESH_HINT = "Check your connection and try again.";

/** What one run reads and writes. Everything in it is stable for one `fetcher`, so a run needs no closure of its own. */
interface RunContext<T> {
  enabled: boolean;
  fetcher: ListFetcher<T>;
  fallback: string;
  loadedRef: { current: boolean };
  /** The fetcher whose answer is the data on screen: the data answers the current query only when it is `fetcher`. */
  answeredRef: { current: ListFetcher<T> | null };
  requestRef: { current: number };
  /** How many loads, changed queries and reloads (not ticks of `poll`) are on their way: a tick waits for the next one. */
  pendingRef: { current: number };
  /** A tick of `poll` is on its way: the next one waits for it. */
  tickingRef: { current: boolean };
  onDataRef: { current: ((data: T) => void) | undefined };
  onErrorRef: { current: ((error: unknown) => void) | undefined };
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
  ctx.pendingRef.current += 1;
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
    ctx.onErrorRef.current?.(err);
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
    ctx.pendingRef.current -= 1;
    limit.done();
    if (!superseded()) {
      ctx.setLoading(false);
      ctx.setRefreshing(false);
    }
  }
}

/**
 * One tick of a live list (see `ListLoad.poll`). It must not take over from a request somebody waits for, so it does
 * nothing while one is on its way, nor while the previous tick is (it would make that one stale and starve the list when
 * the server answers slower than the interval); a failure is ignored, and the request is abandoned like any other (after 30
 * seconds, when the query changes, when the page is left).
 */
async function runListPoll<T>(ctx: RunContext<T>, signal?: AbortSignal): Promise<void> {
  if (!ctx.enabled || ctx.pendingRef.current > 0 || ctx.tickingRef.current) return;
  ctx.tickingRef.current = true;
  const mine = ++ctx.requestRef.current;
  const limit = loadWithTimeout(signal);
  try {
    const next = await rejectOnAbort(ctx.fetcher(limit.signal, { poll: true }), limit.signal);
    if (signal?.aborted || mine !== ctx.requestRef.current) return;
    ctx.setData(next);
    ctx.setError(null);
    ctx.setRefreshError(null);
    ctx.onDataRef.current?.(next);
    ctx.loadedRef.current = true;
    ctx.answeredRef.current = ctx.fetcher;
  } catch {
    // A tick that fails changes nothing: the rows on screen stay, and the next tick asks again.
  } finally {
    ctx.tickingRef.current = false;
    limit.done();
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
export function useListLoad<T>({ fetcher, fallback, enabled = true, onData, onError }: ListLoadOptions<T>): ListLoad<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const dataRef = useRef<T | null>(null);
  const answeredRef = useRef<ListFetcher<T> | null>(null);
  const requestRef = useRef(0);
  const pendingRef = useRef(0);
  const tickingRef = useRef(false);
  // Aborted when the query changes or the page is left, so a reload started by an action follows the same life.
  const lifeRef = useRef<AbortController | null>(null);
  const onDataRef = useRef(onData);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onDataRef.current = onData;
    onErrorRef.current = onError;
  });

  const setAnswer = useCallback((next: T) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const run = useCallback(
    (kind: "query" | "reload" | "poll", signal?: AbortSignal, keepRows?: boolean) => {
      const ctx: RunContext<T> = {
        enabled,
        fetcher,
        fallback,
        loadedRef,
        answeredRef,
        requestRef,
        pendingRef,
        tickingRef,
        onDataRef,
        onErrorRef,
        setData: setAnswer,
        setLoading,
        setRefreshing,
        setError,
        setRefreshError,
      };
      return kind === "poll" ? runListPoll(ctx, signal) : runListLoad(ctx, kind, signal, keepRows);
    },
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

  const poll = useCallback(() => runRef.current("poll", lifeRef.current?.signal), []);

  return { data, loading, refreshing, error, refreshError, enabled, reload, update, poll };
}
