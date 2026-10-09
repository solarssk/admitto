import { Notice } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DialogCrossLink } from "./DialogCrossLink.js";
import { anonymousEntries, freedPlacesLine, peopleCount } from "./erasedAttendee.js";
import "./erase-dialogs.css";

/** What an erasure takes and what it leaves, one line each: the same answer to "will Reports
 * change?" in the dialog of a single person and of a selection. */
function EraseConsequences({ takes, stays }: Readonly<{ takes: readonly string[]; stays: string }>) {
  return (
    <ul className="erase-consequences">
      {takes.map((text) => (
        <li key={text} className="erase-consequences__row">
          <span className="erase-consequences__tag erase-consequences__tag--erased">Erased</span>
          <span>{text}</span>
        </li>
      ))}
      <li className="erase-consequences__row">
        <span className="erase-consequences__tag erase-consequences__tag--stays">Stays</span>
        <span>{stays}</span>
      </li>
    </ul>
  );
}

type EraseDialogBase = Readonly<{
  open: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Closes this dialog and opens the one that removes people from the event instead. */
  onUseRemove: () => void;
  /** The event is archived, and its numbers are final: Remove is off there, so there is no way across to it. */
  eventArchived: boolean;
}>;

/** "A duplicate or a mistake? Use Remove from event", for someone who came here without a privacy request. Left out
 * on an archived event, whose numbers are final: Remove is off there, so there is nowhere to go. */
function RemoveInstead({ busy, ...link }: Readonly<Pick<EraseDialogBase, "onUseRemove" | "eventArchived"> & { busy: boolean }>) {
  return (
    <DialogCrossLink
      question="A duplicate or a mistake?"
      action="Use Remove from event"
      busy={busy}
      onClick={link.eventArchived ? undefined : link.onUseRemove}
    />
  );
}

/** Confirmation to erase one person's personal data. The name has to be typed: erasing cannot be
 * undone, and the attendee's page is the one place that names who is about to lose their data. */
export function EraseAttendeeDialog({
  name,
  freesPlace,
  ...dialog
}: EraseDialogBase & Readonly<{ name: string; freesPlace: boolean }>) {
  return (
    <ConfirmDialog
      open={dialog.open}
      title="Erase this person's personal data?"
      message="Use this for a privacy request. It cannot be undone."
      errorMessage={dialog.error}
      confirmLabel="Erase personal data"
      confirmVariant="danger"
      loading={dialog.busy}
      wide
      confirmationValue={name}
      onConfirm={dialog.onConfirm}
      onCancel={dialog.onCancel}
    >
      <EraseConsequences
        takes={["Name, email, company, notes and answers", "Their ticket, emails and wallet pass"]}
        stays="An anonymous entry in Reports"
      />
      {freesPlace && <Notice variant="warning">Not checked in yet, so their place becomes free.</Notice>}
      <RemoveInstead busy={dialog.busy} onUseRemove={dialog.onUseRemove} eventArchived={dialog.eventArchived} />
    </ConfirmDialog>
  );
}

/** Confirmation to erase the personal data of the selected people. No typed name: there is no
 * single name to type, the same as the bulk delete. `freesPlaceCount` is how many of them the
 * erasure cancels, so that their places become free: the single dialog says so, and so does this. */
export function BulkEraseDialog({
  count,
  freesPlaceCount,
  ...dialog
}: EraseDialogBase & Readonly<{ count: number; freesPlaceCount: number }>) {
  const one = count === 1;
  return (
    <ConfirmDialog
      open={dialog.open}
      title={`Erase personal data of ${peopleCount(count)}?`}
      message="Use this for privacy requests. It cannot be undone."
      errorMessage={dialog.error}
      confirmLabel="Erase personal data"
      confirmVariant="danger"
      loading={dialog.busy}
      wide
      onConfirm={dialog.onConfirm}
      onCancel={dialog.onCancel}
    >
      <EraseConsequences
        takes={
          one
            ? ["Name, email, company, notes and answers", "Their ticket, emails and wallet pass"]
            : ["Names, emails, companies, notes and answers", "Their tickets, emails and wallet passes"]
        }
        stays={`${anonymousEntries(count)} in Reports`}
      />
      {freesPlaceCount > 0 && <Notice variant="warning">{freedPlacesLine(freesPlaceCount)}</Notice>}
      <div className="erase-dialog__notes">
        <p className="erase-dialog__hint">People who are already erased are skipped.</p>
        <RemoveInstead busy={dialog.busy} onUseRemove={dialog.onUseRemove} eventArchived={dialog.eventArchived} />
      </div>
    </ConfirmDialog>
  );
}

/** Shown when everything personal is gone but a wallet pass could not be deleted at the provider
 * (it was unreachable, or ran out of time). "Try again" repeats the erasure, which only tries the
 * pending wallet deletes again. */
export function EraseWalletResultDialog({
  open,
  pending,
  retrying,
  error,
  onTryAgain,
  onClose,
}: Readonly<{
  open: boolean;
  pending: number;
  retrying: boolean;
  error: string | null;
  onTryAgain: () => void;
  onClose: () => void;
}>) {
  return (
    <ConfirmDialog
      open={open}
      title="Personal data erased"
      message="Everything personal inside Admitto is gone."
      errorMessage={error}
      confirmLabel="Try again"
      cancelLabel="Close"
      loading={retrying}
      wide
      onConfirm={onTryAgain}
      onCancel={onClose}
    >
      <Notice variant="warning">
        {pending === 1 ? "The wallet pass is still at the provider." : `${pending} wallet passes are still at the provider.`}
      </Notice>
      <p className="erase-dialog__hint">
        Try again repeats only the wallet step. Still failing? Check the wallet connection in Event settings, or delete
        the pass in the provider&apos;s own console.
      </p>
    </ConfirmDialog>
  );
}
