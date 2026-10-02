import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchIdentityProvider } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { ProviderDetailDto } from "../api/types.js";
import { useRetry } from "../hooks/useRetry.js";
import { loadWithTimeout, rejectOnAbort } from "../utils/load-timeout.js";
import { LOAD_TIMEOUT_MESSAGE } from "../utils/loading-timing.js";
import { redirectToLogin } from "./loginRedirect.js";
import type { EditorMode } from "./identityProviderValidation.js";

export type ProviderLoadState = "loading" | "ready" | "error" | "not_found";

const LOAD_FALLBACK = "Could not load this provider.";

/**
 * The load of the provider an edit modal shows (create mode has nothing to load and is `ready` from the start), on the
 * loading standard: `loading` while the first answer is on its way (the modal draws its placeholder), the 30 second
 * limit (`error` with the timeout text instead of a spinner that never stops), and a Retry (`retry`, `retrying`) that
 * keeps the error and its busy button on screen until the answer is in.
 *
 * It loads again whenever the provider id changes (a deep link, or in-app navigation from one provider's edit URL to
 * another's), and each run owns its AbortController: the cleanup aborts the request in flight, so only the newest
 * one can settle the state, and nothing is left running when the modal is closed. `apply` puts the provider into the
 * modal's own state; `onStart` clears what belongs to the previous provider (stale field errors) and runs on every
 * load, a Retry included. A 404 is `not_found`, a 401 hands the browser over to the login page.
 */
export function useProviderLoad({
  mode,
  providerId,
  apply,
  onStart,
}: {
  mode: EditorMode;
  providerId: string | undefined;
  apply: (detail: ProviderDetailDto) => void;
  onStart: () => void;
}) {
  // The state belongs to the provider it was reached for: a changed id is `loading` from the very render that has it,
  // so the form of the previous provider is covered at once, not one commit later when the effect has started the load.
  const [result, setResult] = useState<{ id: string | undefined; state: ProviderLoadState }>({
    id: providerId,
    state: mode === "edit" ? "loading" : "ready",
  });
  const loadState: ProviderLoadState = mode === "edit" && result.id !== providerId ? "loading" : result.state;
  const [loadError, setLoadError] = useState(LOAD_FALLBACK);
  const { token, retry, begin, end, busy: retrying } = useRetry();
  const applyRef = useRef(apply);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    applyRef.current = apply;
    onStartRef.current = onStart;
  });

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (mode !== "edit" || !providerId) return;
      // A Retry keeps the error on screen until the answer is in; any other run starts over with the placeholder.
      if (!begin()) setResult({ id: providerId, state: "loading" });
      onStartRef.current();
      const limit = loadWithTimeout(signal);
      try {
        // `rejectOnAbort` settles this as an abort the moment the run is abandoned, so a superseded answer never lands.
        const detail = await rejectOnAbort(fetchIdentityProvider(providerId, limit.signal), limit.signal);
        applyRef.current(detail);
        setResult({ id: providerId, state: "ready" });
        end();
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) {
          redirectToLogin();
          return;
        }
        if (err instanceof ApiError && err.status === 404) {
          setResult({ id: providerId, state: "not_found" });
        } else {
          setLoadError(limit.timedOut() ? LOAD_TIMEOUT_MESSAGE : operatorApiErrorMessage(err, LOAD_FALLBACK));
          setResult({ id: providerId, state: "error" });
        }
        end();
      } finally {
        limit.done();
      }
    },
    [mode, providerId, begin, end],
  );

  // No one-shot ref: a ref would keep the previous provider's data on the screen and let Save PUT it onto the new id,
  // and would strand the editor on a placeholder under React StrictMode (the #296 regression).
  useEffect(() => {
    if (mode !== "edit") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [mode, load, token]);

  return { loadState, loadError, retrying, retry };
}
