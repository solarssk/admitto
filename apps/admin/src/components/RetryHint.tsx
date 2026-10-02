import { Button } from "@admitto/ui";
import { useBusyEndCount } from "../hooks/useRetry.js";

/**
 * The one-line "could not load" hint with its Retry, for a field-sized spot (a filter, a picker) where a Notice
 * would be too heavy. It is an alert, and `busy` (from `useRetry`) is the Retry's own flag: the Retry stays on
 * screen and focusable while it works (`Button loading`), and when a retry ends with the error still there the
 * message is mounted afresh, never the button, so the same text is announced again, as `Notice` does with its
 * `actionBusy`. With no `onRetry` there is no button.
 */
export function RetryHint({
  message,
  busy,
  onRetry,
  retryLabel,
}: Readonly<{
  message: string;
  busy: boolean;
  onRetry?: () => void;
  /** The Retry's accessible name when several hints can be on screen at once ("Retry loading events"); it starts with "Retry". */
  retryLabel?: string;
}>) {
  const attempts = useBusyEndCount(busy);
  return (
    <p className="mail-field-hint retry-hint" role="alert">
      <span key={attempts}>{message}</span>
      {onRetry && (
        <>
          {" "}
          <Button type="button" variant="ghost" size="sm" className="retry-hint__button" aria-label={retryLabel} loading={busy} onClick={onRetry}>
            Retry
          </Button>
        </>
      )}
    </p>
  );
}
