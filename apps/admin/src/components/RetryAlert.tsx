import { useRef } from "react";
import { Button } from "@admitto/ui";
import { useBusyEndCount } from "../hooks/useRetry.js";
import { useRetryFocusHandover } from "../hooks/useRetryFocusHandover.js";

/**
 * "Could not load" as a compact line inside a card that has its own layout (`className`), for the places where an
 * `EmptyState` would be too heavy. It is an alert, and its Retry stays on screen, busy (`retrying`, from
 * `useRetryKeepingError`), until the answer is in: a Retry that disappears on the click takes the keyboard focus with it.
 * A message that a retry did not clear is mounted afresh, never the button, so a live region says it again and the
 * button keeps its focus; when the retry works the focus goes to the card that holds the list (`landmark`), instead of
 * falling to the page. It fades in with what it replaces, once: it stays mounted through a Retry.
 */
export function RetryAlert({
  message,
  retrying,
  onRetry,
  className,
  landmark = ".at-card",
}: Readonly<{
  message: string;
  retrying: boolean;
  onRetry: () => Promise<void>;
  /** The card's own layout class for the alert. */
  className: string;
  /** The selector of the region that stays when the retry works, where the keyboard focus goes. */
  landmark?: string;
}>) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useRetryFocusHandover(retryRef, landmark);
  const ends = useBusyEndCount(retrying);
  return (
    <div className={`${className} at-fade-in`} role="alert">
      <p key={ends}>{message}</p>
      <Button ref={retryRef} type="button" variant="secondary" loading={retrying} onClick={() => void onRetry()}>
        Retry
      </Button>
    </div>
  );
}
