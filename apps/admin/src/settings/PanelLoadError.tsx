import type { ReactNode } from "react";
import { Button, Card, Notice } from "@admitto/ui";

/**
 * A settings panel whose first load failed: the card with its title, what failed and why (an alert), and a Retry that
 * loads it again. The Retry is busy (`retrying`, from `usePanelLoad`) while it works and the error stays on screen until
 * the answer is in, so the keyboard keeps its place; a retry that fails again with the same message is announced again.
 */
export function PanelLoadError({
  cardTitle,
  title,
  message,
  retrying,
  onRetry,
}: Readonly<{ cardTitle: ReactNode; title: string; message: string; retrying: boolean; onRetry: () => Promise<void> }>) {
  return (
    <Card title={cardTitle}>
      <Notice
        variant="error"
        role="alert"
        actionBusy={retrying}
        action={
          <Button type="button" variant="secondary" size="sm" loading={retrying} onClick={() => void onRetry()}>
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
