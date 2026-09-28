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
 * Guards its success/error side effects against the operator navigating to a different event
 * before the request resolves (same isStillOnEvent pattern as the page's own bulk actions) and
 * aborts the poll when the event changes or the page unmounts, so a toast never lands on the
 * wrong event. */
export function useWalletVoidActive(params: {
  eventId: string | undefined;
  addToast: (message: string, variant?: ToastVariant) => void;
  reportApiError: (status: number) => void;
  /** Reload the attendee list once the job has finished, so the new pass statuses show. */
  onFinished: () => void;
}) {
  const { eventId, addToast, reportApiError, onFinished } = params;
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const pollRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pollRef.current?.abort();
      pollRef.current = null;
    };
  }, [eventId]);

  const requestConfirm = () => {
    setError(null);
    setConfirmOpen(true);
  };

  const cancel = () => {
    if (busy) return;
    setConfirmOpen(false);
    setError(null);
  };

  const confirm = async () => {
    if (!eventId) return;
    const initiatingEventId = eventId;
    const isStillOnEvent = () => eventIdRef.current === initiatingEventId;
    setBusy(true);
    setError(null);
    try {
      const result = await triggerEventWideWalletVoidActive(initiatingEventId);
      if (!isStillOnEvent()) return;
      setConfirmOpen(false);
      addToast(WALLET_CLEANUP_COPY.void_active.queued, "info");
      pollRef.current?.abort();
      const ac = new AbortController();
      pollRef.current = ac;
      void pollWalletCleanupCompletion("void_active", initiatingEventId, result.jobId, addToast, {
        signal: ac.signal,
        onSuccess: onFinished,
      }).catch(() => {
        if (ac.signal.aborted) return;
        addToast(WALLET_CLEANUP_COPY.void_active.failed, "info");
      });
    } catch (err) {
      if (isStillOnEvent()) {
        reportBulkActionError(err, {
          reportApiError,
          setError,
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
