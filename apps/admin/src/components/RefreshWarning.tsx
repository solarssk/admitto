import { useRef, useState } from "react";
import { Button, Notice } from "@admitto/ui";
import { useMinimumBusy } from "../hooks/useDelayedLoading.js";
import { useRetryFocusHandover } from "../hooks/useRetryFocusHandover.js";

/**
 * "Could not refresh": the list that was on screen stays, and this says that it may be older than the server's,
 * with a Retry that reruns the refresh. The Retry is busy from its own click for at least 400ms, so a retry that
 * fails again at once still shows that it ran, and the warning is announced again (`Notice` `actionBusy`).
 * A warning that sits in a region that stays (a page, a card) passes its selector as `landmark`: when the
 * Retry works and the warning goes, the keyboard focus that was on the Retry moves to that region instead of
 * falling to the page.
 */
export function RefreshWarning({
  message,
  onRetry,
  landmark,
}: Readonly<{ message: string; onRetry: () => Promise<void>; landmark?: string }>) {
  const [retrying, setRetrying] = useState(false);
  const busy = useMinimumBusy(retrying);
  const retryRef = useRef<HTMLButtonElement>(null);
  useRetryFocusHandover(retryRef, landmark, landmark !== undefined);
  const retry = () => {
    setRetrying(true);
    void onRetry().finally(() => setRetrying(false));
  };
  return (
    <Notice
      variant="warning"
      role="alert"
      actionBusy={busy}
      action={
        <Button ref={retryRef} type="button" variant="secondary" size="sm" loading={busy} onClick={retry}>
          Retry
        </Button>
      }
    >
      {message}
    </Notice>
  );
}
