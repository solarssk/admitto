import { useState } from "react";
import { Button, Notice } from "@admitto/ui";
import { useMinimumBusy } from "../hooks/useDelayedLoading.js";

/**
 * "Could not refresh": the list that was on screen stays, and this says that it may be older than the server's,
 * with a Retry that reruns the refresh. The Retry is busy from its own click for at least 400ms, so a retry that
 * fails again at once still shows that it ran, and the warning is announced again (`Notice` `actionBusy`).
 */
export function RefreshWarning({ message, onRetry }: Readonly<{ message: string; onRetry: () => Promise<void> }>) {
  const [retrying, setRetrying] = useState(false);
  const busy = useMinimumBusy(retrying);
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
        <Button type="button" variant="secondary" size="sm" loading={busy} onClick={retry}>
          Retry
        </Button>
      }
    >
      {message}
    </Notice>
  );
}
