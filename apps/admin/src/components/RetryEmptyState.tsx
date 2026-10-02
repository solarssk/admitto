import { useRef } from "react";
import { Button, EmptyState } from "@admitto/ui";
import { useBusyEndCount } from "../hooks/useRetry.js";
import { useRetryFocusHandover } from "../hooks/useRetryFocusHandover.js";

/**
 * A card or list whose load failed: what failed and why (an alert) and a Retry that stays on screen, busy
 * (`retrying`, from `useRetryKeepingError`), until the answer is in. A message that a retry did not clear is mounted
 * afresh, never the button, so a live region says it again and the button keeps its focus; when the retry works the
 * focus moves to the tab panel the error sat in instead of falling to the page.
 */
export function RetryEmptyState({
  title,
  message,
  retrying,
  onRetry,
  retryLabel,
}: Readonly<{
  title: string;
  message: string;
  retrying: boolean;
  onRetry: () => Promise<void>;
  /** The Retry's accessible name when several can be on screen at once ("Retry loading providers"); it starts with "Retry". */
  retryLabel?: string;
}>) {
  const retryRef = useRef<HTMLButtonElement>(null);
  // The card that holds the list stays when the list arrives: the focus goes there, not to the top of the tab.
  useRetryFocusHandover(retryRef, ".at-card");
  const ends = useBusyEndCount(retrying);
  return (
    <EmptyState
      variant="error"
      title={title}
      description={<span key={ends}>{message}</span>}
      action={
        <Button
          ref={retryRef}
          type="button"
          variant="secondary"
          aria-label={retryLabel}
          loading={retrying}
          onClick={() => void onRetry()}
        >
          Retry
        </Button>
      }
    />
  );
}
