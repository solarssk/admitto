import { useEffect, useRef, useState } from "react";
import type { ToastVariant } from "@admitto/ui";
import { triggerEventWideWalletVoidActive } from "../api/client.js";
import { pollWalletCleanupCompletion } from "./pollWalletCleanupCompletion.js";
import { reportBulkActionError } from "./reportBulkActionError.js";
import { WALLET_CLEANUP_COPY } from "./walletCleanupCopy.js";

/** State and handlers behind the Attendees header's "Void active passes": the confirm dialog, the
 * request that queues the event-wide job, and the detached poll that reports the outcome. Kept out
 * of AttendeesPage itself (its own cognitive complexity is already near the SonarCloud limit); the
 * page just wires `confirmOpen`/`busy`/`error` into a ConfirmDialog and `requestConfirm` into the
 * menu item.
 *
 * The confirmation belongs to the event it was opened on: `confirmEventId` is captured by
 * `requestConfirm`, `confirm` acts on that event only, and the dialog (and any error shown on it)
 * disappears as soon as the route event differs. Otherwise a dialog left open across a navigation
 * could void every active pass of an event the operator never confirmed. The success and error side
 * effects of a request that resolves after such a navigation are dropped the same way, and the poll
 * is aborted when the event changes or the page unmounts, so a toast never lands on the wrong
 * event. */
export function useWalletVoidActive(params: {
  eventId: string | undefined;
  addToast: (message: string, variant?: ToastVariant) => void;
  reportApiError: (status: number) => void;
  /** Reload the attendee list once the job has finished, so the new pass statuses show. */
  onFinished: () => void;
}) {
  const { eventId, addToast, reportApiError, onFinished } = params;
  const [busy, setBusy] = useState(false);
  const [confirmEventId, setConfirmEventId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<{ eventId: string; message: string } | null>(null);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const pollRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pollRef.current?.abort();
      pollRef.current = null;
    };
  }, [eventId]);

  const confirmOpen = confirmEventId !== null && confirmEventId === eventId;
  const error = errorState !== null && errorState.eventId === eventId ? errorState.message : null;

  const requestConfirm = () => {
    if (!eventId) return;
    setErrorState(null);
    setConfirmEventId(eventId);
  };

  const cancel = () => {
    if (busy) return;
    setConfirmEventId(null);
    setErrorState(null);
  };

  const confirm = async () => {
    const targetEventId = confirmEventId;
    if (!targetEventId || targetEventId !== eventIdRef.current) return;
    const isStillOnEvent = () => eventIdRef.current === targetEventId;
    setBusy(true);
    setErrorState(null);
    try {
      const result = await triggerEventWideWalletVoidActive(targetEventId);
      if (!isStillOnEvent()) return;
      setConfirmEventId(null);
      addToast(WALLET_CLEANUP_COPY.void_active.queued, "info");
      pollRef.current?.abort();
      const ac = new AbortController();
      pollRef.current = ac;
      void pollWalletCleanupCompletion("void_active", targetEventId, result.jobId, addToast, {
        signal: ac.signal,
        onSuccess: onFinished,
      }).catch(() => {
        if (ac.signal.aborted) return;
        addToast(WALLET_CLEANUP_COPY.void_active.pollFailed, "info");
      });
    } catch (err) {
      if (isStillOnEvent()) {
        reportBulkActionError(err, {
          reportApiError,
          setError: (message) => setErrorState(message === null ? null : { eventId: targetEventId, message }),
          addToast,
          apiErrorFallback: "Voiding the wallet passes failed.",
          genericFallback: "Failed to void the wallet passes.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return { busy, confirmOpen, error, requestConfirm, cancel, confirm };
}
