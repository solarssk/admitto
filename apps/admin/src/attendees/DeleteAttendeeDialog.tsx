import { ConfirmDialog } from "../components/ConfirmDialog.js";

/** Confirmation to permanently delete one attendee, with the attendee's name to be typed. Shared by
 * the attendee page and the read-only page of an erased attendee. */
export function DeleteAttendeeDialog({
  open,
  name,
  busy,
  error,
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean;
  name: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <ConfirmDialog
      open={open}
      title="Permanently delete this attendee?"
      message={`This cannot be undone. Deleting ${name} permanently removes:`}
      errorMessage={error}
      confirmLabel="Delete"
      confirmVariant="danger"
      loading={busy}
      confirmationValue={name}
      confirmationLabel={`Type the attendee's name to confirm: "${name}"`}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <ul className="confirm-dialog__list">
        <li>Profile and contact details</li>
        <li>Ticket deliveries</li>
        <li>Wallet pass</li>
        <li>Check-in history</li>
      </ul>
    </ConfirmDialog>
  );
}
