import { Button } from "@admitto/ui";
import { FailureIcon } from "../components/FailureIcon.js";
import { useBusyEndCount } from "../hooks/useRetry.js";

/**
 * An Identity editor whose record could not be loaded: what failed and why (an alert) and a Retry that stays on screen,
 * busy (`retrying`), until the answer is in, so the keyboard keeps its place. A message that a retry did not clear is
 * mounted afresh, never the button, so a live region says it again. When a retry works, this block goes and the form
 * takes its place: the modal's own focus handling then keeps the focus in the dialog (on its first control), as it does after a
 * first load.
 */
export function IdentityEditorLoadError({
  message,
  retrying,
  onRetry,
}: Readonly<{ message: string; retrying: boolean; onRetry: () => void }>) {
  const ends = useBusyEndCount(retrying);
  return (
    <div className="identity-editor__error" role="alert">
      <p key={ends}>
        <FailureIcon className="failure-icon--large" />
        {message}
      </p>
      <Button type="button" variant="secondary" loading={retrying} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
