import { useRef, type ReactNode } from "react";
import { Button, Notice } from "@admitto/ui";
import { useRetryFocusHandover } from "../../hooks/useRetryFocusHandover.js";
import { SLOW_NOTICE_TEXT } from "../../utils/loading-timing.js";
import "../setup-wizard.css";

/** Where the focus goes when the Retry that held it goes away because the read worked: the body of the step. */
const STEP_BODY = ".setup-wizard__body";

/**
 * What a step of the wizard shows while its first read runs: the shapes of what will be there, in a status region named after
 * what is loading. `held` is the first 200ms, when the room is reserved and nothing is drawn; after 8 seconds (`slow`) the
 * region says it is taking longer than usual.
 */
export function WizardStepPlaceholder({
  label,
  held,
  slow,
  children,
}: Readonly<{ label: string; held: boolean; slow: boolean; children: ReactNode }>) {
  return (
    <output aria-label={label} className={held ? "setup-wizard__placeholder at-loading-hold" : "setup-wizard__placeholder"}>
      <div aria-hidden="true">{children}</div>
      {slow ? <span className="at-hint setup-wizard__placeholder-note">{SLOW_NOTICE_TEXT}</span> : null}
    </output>
  );
}

/**
 * A step whose read failed, or whose checks did not pass: what went wrong (an alert) and a Retry that is busy (`retrying`)
 * while it works. The Retry stays on screen until the answer is in, so the keyboard keeps its place, and a retry that fails
 * again with the same message is announced again. When a retry works, the notice and the Retry that holds the focus go
 * away and the step takes their place: the focus then moves to the step's body (a browser would drop it on `<body>`), and
 * the next Tab goes on from there. Focus that is somewhere else by then is left alone.
 */
export function WizardRetryNotice({
  children,
  retrying,
  onRetry,
  className,
  retryClassName,
}: Readonly<{
  children: ReactNode;
  retrying: boolean;
  onRetry: () => Promise<void>;
  className?: string;
  retryClassName?: string;
}>) {
  const retryRef = useRef<HTMLButtonElement>(null);
  useRetryFocusHandover(retryRef, STEP_BODY);
  return (
    <Notice
      variant="error"
      role="alert"
      className={className}
      actionBusy={retrying}
      action={
        <Button
          ref={retryRef}
          type="button"
          variant="secondary"
          size="sm"
          className={retryClassName}
          loading={retrying}
          onClick={() => void onRetry()}
        >
          Retry
        </Button>
      }
    >
      {children}
    </Notice>
  );
}
