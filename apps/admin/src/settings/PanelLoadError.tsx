import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Button, Card, Notice } from "@admitto/ui";

/**
 * A settings panel whose first load failed: the card with its title, what failed and why (an alert), and a Retry that
 * loads it again. The Retry is busy (`retrying`, from `usePanelLoad`) while it works and the error stays on screen until
 * the answer is in, so the keyboard keeps its place; a retry that fails again with the same message is announced again.
 * When a retry works, this card goes and the form takes its place: focus that was on the Retry then moves to the tab
 * panel the card sat in (a browser would drop it on `<body>`), so a screen reader hears where it is and the next Tab
 * goes into the form. Focus that is somewhere else by then is left alone.
 */
export function PanelLoadError({
  cardTitle,
  title,
  message,
  retrying,
  onRetry,
}: Readonly<{ cardTitle: ReactNode; title: string; message: string; retrying: boolean; onRetry: () => Promise<void> }>) {
  const retryRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const retry = retryRef.current;
    // React runs this cleanup before it takes the card out of the page, so the Retry still holds focus (and has its
    // tab panel above it) here; by the time the microtask runs the form is in and the Retry is gone.
    return () => {
      if (!retry || document.activeElement !== retry) return;
      const tabPanel = retry.closest<HTMLElement>('[role="tabpanel"]');
      if (!tabPanel) return;
      queueMicrotask(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        if (!tabPanel.hasAttribute("tabindex")) tabPanel.tabIndex = -1;
        tabPanel.focus();
      });
    };
  }, []);

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
