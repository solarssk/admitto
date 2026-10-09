import { useId, useState } from "react";
import { ATTENDEE_REMOVAL_REASONS, ATTENDEE_REMOVAL_REASON_LABELS, type AttendeeRemovalReason } from "@admitto/shared";
import { Notice } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DialogCrossLink } from "./DialogCrossLink.js";
import { peopleCount } from "./erasedAttendee.js";
import { DEFAULT_REMOVAL_REASON, REMOVE_CHECKED_IN_LINE, removedCheckInsLine } from "./removeAttendee.js";
import "./remove-dialogs.css";

/** The reason chosen in a Remove dialog. It starts from the default each time the dialog opens, in the render that
 * opens it, so that no frame shows the choice of the last time. */
function useRemovalReason(open: boolean) {
  const [reason, setReason] = useState<AttendeeRemovalReason>(DEFAULT_REMOVAL_REASON);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReason(DEFAULT_REMOVAL_REASON);
  }
  return [reason, setReason] as const;
}

/** The fixed list of reasons: one is required, and none is free text, so that the audit log never holds anything a
 * person typed. */
function RemovalReasons({
  reason,
  busy,
  onChange,
}: Readonly<{ reason: AttendeeRemovalReason; busy: boolean; onChange: (reason: AttendeeRemovalReason) => void }>) {
  const group = useId();
  return (
    <fieldset className="remove-reasons">
      <legend className="remove-reasons__legend">Reason</legend>
      {ATTENDEE_REMOVAL_REASONS.map((value) => (
        <label key={value} className="remove-reasons__option">
          <input
            type="radio"
            name={group}
            value={value}
            checked={reason === value}
            // Off while the request runs, like the typed name: the button that started it is the busy control.
            disabled={busy}
            onChange={() => onChange(value)}
          />
          <span>{ATTENDEE_REMOVAL_REASON_LABELS[value]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** What both Remove dialogs ask besides the confirmation: the reason, and a way across to Erase for someone who came
 * with a privacy request. */
function RemovalChoice({
  reason,
  busy,
  onChange,
  onUseErase,
}: Readonly<{
  reason: AttendeeRemovalReason;
  busy: boolean;
  onChange: (reason: AttendeeRemovalReason) => void;
  onUseErase: (() => void) | undefined;
}>) {
  return (
    <div className="remove-dialog__choice">
      <RemovalReasons reason={reason} busy={busy} onChange={onChange} />
      <DialogCrossLink question="A privacy request?" action="Use Erase personal data" busy={busy} onClick={onUseErase} />
    </div>
  );
}

type RemoveDialogBase = Readonly<{
  open: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (reason: AttendeeRemovalReason) => void;
  onCancel: () => void;
  /** Closes this dialog and opens the one that erases personal data instead. Left out for someone who is erased
   * already. */
  onUseErase?: () => void;
}>;

/** Confirmation to remove one person from the event for good, with the reason and the person's name to be typed:
 * removing cannot be undone, and it takes the person out of Reports. */
export function RemoveAttendeeDialog({
  name,
  checkedIn,
  ...dialog
}: RemoveDialogBase & Readonly<{ name: string; checkedIn: boolean }>) {
  const [reason, setReason] = useRemovalReason(dialog.open);
  return (
    <ConfirmDialog
      open={dialog.open}
      title="Remove this person from the event?"
      message="Use this for a duplicate, a test person or a mistake. Reports will change. It cannot be undone."
      errorMessage={dialog.error}
      confirmLabel="Remove from event"
      confirmVariant="danger"
      loading={dialog.busy}
      wide
      confirmationValue={name}
      onConfirm={() => dialog.onConfirm(reason)}
      onCancel={dialog.onCancel}
    >
      {checkedIn && <Notice variant="warning">{REMOVE_CHECKED_IN_LINE}</Notice>}
      <RemovalChoice reason={reason} busy={dialog.busy} onChange={setReason} onUseErase={dialog.onUseErase} />
    </ConfirmDialog>
  );
}

/** Confirmation to remove the selected people. No typed name: there is no single name to type, the same as the bulk
 * erase. `checkedInCount` is how many of them have checked in, so that the dialog says their check-ins go too. */
export function BulkRemoveDialog({
  count,
  checkedInCount,
  ...dialog
}: RemoveDialogBase & Readonly<{ count: number; checkedInCount: number }>) {
  const [reason, setReason] = useRemovalReason(dialog.open);
  return (
    <ConfirmDialog
      open={dialog.open}
      title={`Remove ${peopleCount(count)} from the event?`}
      message="Use this for duplicates, test people or mistakes. Reports will change. It cannot be undone."
      errorMessage={dialog.error}
      confirmLabel="Remove from event"
      confirmVariant="danger"
      loading={dialog.busy}
      wide
      onConfirm={() => dialog.onConfirm(reason)}
      onCancel={dialog.onCancel}
    >
      {checkedInCount > 0 && <Notice variant="warning">{removedCheckInsLine(checkedInCount)}</Notice>}
      <RemovalChoice reason={reason} busy={dialog.busy} onChange={setReason} onUseErase={dialog.onUseErase} />
    </ConfirmDialog>
  );
}
