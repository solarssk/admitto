import { useRef, type ReactNode } from "react";
import { Button, Card, Notice } from "@admitto/ui";
import { useRetryFocusHandover } from "../hooks/useRetryFocusHandover.js";

/**
 * A settings panel whose first load failed: the card with its title, what failed and why (an alert), and a Retry that
 * loads it again. The Retry is busy (`retrying`, from `usePanelLoad`) while it works and the error stays on screen until
 * the answer is in, so the keyboard keeps its place; a retry that fails again with the same message is announced again.
 * When a retry works, this card goes and the form takes its place: focus that was on the Retry then moves to the tab
 * panel the card sat in (a browser would drop it on `<body>`), so a screen reader hears where it is and the next Tab
 * goes into the form. Focus that is somewhere else by then is left alone. A page that has no tab panel passes the
 * selector of the region that stays (`landmark`).
 */
export function PanelLoadError({
  cardTitle,
  title,
  message,
  retrying,
  onRetry,
  landmark,
}: Readonly<{
  cardTitle: ReactNode;
  title: string;
  message: string;
  retrying: boolean;
  onRetry: () => Promise<void>;
  landmark?: string;
}>) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useRetryFocusHandover(retryRef, landmark);

  return (
    <Card title={cardTitle}>
      <Notice
        variant="error"
        role="alert"
        actionBusy={retrying}
        action={
          <Button
            ref={retryRef}
            type="button"
            variant="secondary"
            size="sm"
            loading={retrying}
            onClick={() => void onRetry()}
          >
            Retry
          </Button>
        }
      >
        <strong>{title}</strong>
        <br />
        {message}
      </Notice>
    </Card>
  );
}
