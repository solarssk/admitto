import { useRef } from "react";
import { Button } from "@admitto/ui";
import { useBusyEndCount } from "../hooks/useRetry.js";
import { useRetryFocusHandover } from "../hooks/useRetryFocusHandover.js";

/**
 * The one-line "could not load" hint with its Retry, for a field-sized spot (a filter, a picker) where a Notice
 * would be too heavy. It is an alert, and `busy` (from `useRetry`) is the Retry's own flag: the Retry stays on
 * screen and focusable while it works (`Button loading`), and when a retry ends with the error still there the
 * message is mounted afresh, never the button, so the same text is announced again, as `Notice` does with its
 * `actionBusy`. With no `onRetry` there is no button. When the retry works the hint goes away with the Retry that holds
 * the keyboard focus, which a browser would drop on `<body>`: a hint that sits in a page that has a region to hand the
 * focus to (the body of a wizard step) passes its selector as `landmark`, and the focus goes there (`useRetryFocusHandover`:
 * only when it was on the Retry, and still on nothing when the microtask runs); a hint in a dialog needs none, since
 * `useModalFocusTrap` recovers the focus there.
 */
export function RetryHint({
  message,
  busy,
  onRetry,
  retryLabel,
  landmark,
}: Readonly<{
  message: string;
  busy: boolean;
  onRetry?: () => void;
  /** The Retry's accessible name when several hints can be on screen at once ("Retry loading events"); it starts with "Retry". */
  retryLabel?: string;
  /** The selector of the region that stays when the retry works, where the keyboard focus goes. */
  landmark?: string;
}>) {
  const attempts = useBusyEndCount(busy);
  const retryRef = useRef<HTMLButtonElement>(null);
  // Only a hint that is given a region does it: with none, the hand-over would fall back to the tab panel the hint sits in, which
  // is wrong for a hint in a dialog that is itself inside a tab panel.
  useRetryFocusHandover(retryRef, landmark, landmark !== undefined);
  return (
    <p className="mail-field-hint retry-hint" role="alert">
      <span key={attempts}>{message}</span>
      {onRetry && (
        <>
          {" "}
          <Button ref={retryRef} type="button" variant="ghost" size="sm" className="retry-hint__button" aria-label={retryLabel} loading={busy} onClick={onRetry}>
            Retry
          </Button>
        </>
      )}
    </p>
  );
}
