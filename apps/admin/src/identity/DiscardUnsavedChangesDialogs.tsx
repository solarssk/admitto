import type { RefObject } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";

/** Suspends the editor's own focus trap whenever either discard dialog is open - otherwise its
 * Escape/keydown listener (registered first, since it mounts before either dialog opens) fires
 * first and reopens a second, visually identical discard dialog instead of leaving the topmost
 * one to handle Escape alone (bot review finding; same pattern as UserEditModal's
 * `anyConfirmDialogOpen`). Shared by CfAccessEditor and IdentityProviderEditor, which both wrap
 * `useModalFocusTrap` this exact way. */
export function useEditorFocusTrap(
  panelRef: RefObject<HTMLElement | null>,
  discardConfirmOpen: boolean,
  blockerBlocked: boolean,
  handleCancel: () => void,
  focusWhenReady: unknown,
): void {
  useModalFocusTrap(panelRef, !discardConfirmOpen && !blockerBlocked, handleCancel, focusWhenReady);
}

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
