import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@admitto/ui";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EraseAttendeesResponse } from "../api/types.js";

type PendingWallet = {
  /** How many erased people still have a pass at the provider. */
  count: number;
  /** Repeats the erasure the pass belongs to: for attendees that are already erased it only tries
   * the pending wallet deletes again. */
  retry: () => Promise<EraseAttendeesResponse>;
};

/**
 * State of the dialog that says "Personal data erased, but a wallet pass is still at the provider"
 * and offers Try again. Shared by the Attendees list and the attendee page: each opens it with the
 * number of passes left and a function that repeats its own erasure request.
 *
 * `scopeKey` identifies the event (and attendee) the page shows; when it changes the dialog closes
 * and a retry that was already on its way is dropped, so nothing from the old page reaches the new
 * one. `onSettled` runs after every retry that got an answer, to refresh what the page shows.
 */
export function useEraseWalletResult({ scopeKey, onSettled }: Readonly<{ scopeKey: string; onSettled: () => void }>) {
  const { addToast } = useToast();
  const [pending, setPending] = useState<PendingWallet | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => {
    setPending(null);
    setRetrying(false);
    setError(null);
  }, [scopeKey]);

  const open = useCallback((count: number, retry: () => Promise<EraseAttendeesResponse>) => {
    setError(null);
    setPending({ count, retry });
  }, []);

  const close = useCallback(() => {
    if (retrying) return;
    setPending(null);
    setError(null);
  }, [retrying]);

  const tryAgain = useCallback(async () => {
    if (!pending) return;
    const startedIn = scopeRef.current;
    setRetrying(true);
    setError(null);
    try {
      const result = await pending.retry();
      if (scopeRef.current !== startedIn) return;
      if (result.wallet_pending > 0) {
        setPending({ ...pending, count: result.wallet_pending });
      } else {
        setPending(null);
        addToast(pending.count === 1 ? "Wallet pass deleted" : "Wallet passes deleted", "success");
      }
      onSettled();
    } catch (err) {
      if (scopeRef.current === startedIn) setError(operatorApiErrorMessage(err, "Could not try again. Try again in a moment."));
    } finally {
      if (scopeRef.current === startedIn) setRetrying(false);
    }
  }, [pending, addToast, onSettled]);

  return {
    open,
    dialogProps: {
      open: pending !== null,
      pending: pending?.count ?? 0,
      retrying,
      error,
      onTryAgain: () => void tryAgain(),
      onClose: close,
    },
  };
}
