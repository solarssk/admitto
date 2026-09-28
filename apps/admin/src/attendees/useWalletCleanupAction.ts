import { useEffect, useRef, useState } from "react";
import type { ToastVariant } from "@admitto/ui";
import { pollWalletCleanupCompletion } from "./pollWalletCleanupCompletion.js";
import { reportBulkActionError } from "./reportBulkActionError.js";
import { useEventScopedConfirm } from "./useEventScopedConfirm.js";
import { WALLET_CLEANUP_COPY, type WalletCleanupAction } from "./walletCleanupCopy.js";

/** State and handlers behind one event-wide wallet clean-up action in the Attendees header
 * ("Void active passes", "Remove inactive passes"): the confirm dialog, the request that queues
 * the background job, and the detached poll that reports the outcome. Shared by both actions
 * (`useWalletVoidActive`/`useWalletRemoveInactive` below are thin wrappers) rather than copied,
 * since the two are identical apart from which endpoint to call and which copy to read - kept out
 * of AttendeesPage itself either way (its own cognitive complexity is already near the SonarCloud
 * limit); the page just wires `confirmOpen`/`busy`/`error` into a ConfirmDialog and
 * `requestConfirm` into the menu item.
 *
 * The confirmation belongs to the event it was opened on, via `useEventScopedConfirm`: it
 * disappears as soon as the route event differs and does not come back if the operator returns to
 * that event - otherwise a dialog left open across a there-and-back navigation could reappear on
 * its own and act on every eligible pass of that event on a stale confirm, without a fresh menu
 * click. The success and error side effects of a request that resolves after such a navigation are
 * dropped the same way, and the poll is aborted when the event changes or the page unmounts, so a
 * toast never lands on the wrong event. */
export function useWalletCleanupAction(params: {
  action: WalletCleanupAction;
  eventId: string | undefined;
  trigger: (eventId: string) => Promise<{ jobId: string }>;
  addToast: (message: string, variant?: ToastVariant) => void;
  reportApiError: (status: number) => void;
  apiErrorFallback: string;
  genericFallback: string;
  /** Reload the attendee list once the job has finished, so the new pass statuses show. */
  onFinished: () => void;
}) {
  const { action, eventId, trigger, addToast, reportApiError, apiErrorFallback, genericFallback, onFinished } =
    params;
  const copy = WALLET_CLEANUP_COPY[action];
  const [busy, setBusy] = useState(false);
  const confirmation = useEventScopedConfirm(eventId);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const pollRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pollRef.current?.abort();
      pollRef.current = null;
    };
  }, [eventId]);

  const cancel = () => {
    if (!busy) confirmation.close();
  };

  const confirm = async () => {
    const targetEventId = confirmation.target();
    if (!targetEventId) return;
    const isStillOnEvent = () => eventIdRef.current === targetEventId;
    setBusy(true);
    confirmation.setError(null);
    try {
      const result = await trigger(targetEventId);
      if (!isStillOnEvent()) return;
      confirmation.close();
      addToast(copy.queued, "info");
      pollRef.current?.abort();
      const ac = new AbortController();
      pollRef.current = ac;
      void pollWalletCleanupCompletion(action, targetEventId, result.jobId, addToast, {
        signal: ac.signal,
        onSuccess: onFinished,
      }).catch(() => {
        if (ac.signal.aborted) return;
        addToast(copy.pollFailed, "info");
      });
    } catch (err) {
      if (isStillOnEvent()) {
        reportBulkActionError(err, {
          reportApiError,
          setError: confirmation.setError,
          addToast,
          apiErrorFallback,
          genericFallback,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    confirmOpen: confirmation.open,
    error: confirmation.error,
    requestConfirm: confirmation.request,
    cancel,
    confirm,
  };
}
