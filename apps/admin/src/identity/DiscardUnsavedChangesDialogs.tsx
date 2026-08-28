import { ConfirmDialog } from "../components/ConfirmDialog.js";

type DiscardUnsavedChangesDialogsProps = {
  /** What's being discarded, e.g. "You have unsaved changes to this identity provider." */
  message: string;
  cancelDialogOpen: boolean;
  onCancelDialogConfirm: () => void;
  onCancelDialogDismiss: () => void;
  blockerDialogOpen: boolean;
  onBlockerDialogConfirm: () => void;
  onBlockerDialogDismiss: () => void;
};

/** The two "Discard unsaved changes?" dialogs shared by CfAccessEditor and
 * IdentityProviderEditor - one for the Cancel button, one for the router's dirty-guard
 * blocker (in-app navigation away from the editor). Identical in both editors except for
 * `message`; the actual discard/keep-editing logic stays with the caller. */
export function DiscardUnsavedChangesDialogs({
  message,
  cancelDialogOpen,
  onCancelDialogConfirm,
  onCancelDialogDismiss,
  blockerDialogOpen,
  onBlockerDialogConfirm,
  onBlockerDialogDismiss,
}: Readonly<DiscardUnsavedChangesDialogsProps>) {
  return (
    <>
      <ConfirmDialog
        open={cancelDialogOpen}
        title="Discard unsaved changes?"
        message={message}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={onCancelDialogConfirm}
        onCancel={onCancelDialogDismiss}
      />
      <ConfirmDialog
        open={blockerDialogOpen}
        title="Discard unsaved changes?"
        message={message}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={onBlockerDialogConfirm}
        onCancel={onBlockerDialogDismiss}
      />
    </>
  );
}
