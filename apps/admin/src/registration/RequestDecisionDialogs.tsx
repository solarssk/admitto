import { useState } from "react";
import { Checkbox, Notice } from "@admitto/ui";
import type { RegistrationListItemDto } from "../api/types.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import {
  acceptedAmong,
  describeFilter,
  seatsNeeded,
  selectionActions,
  type MatchingTarget,
} from "./registrationDecisions.js";
import type { PendingDecision } from "./useRegistrationDecisions.js";
import "./registration-requests.css";

interface DialogProps {
  busy: boolean;
  /** Why the last try failed, in the words of the app. The dialog stays open with it. */
  error: string | null;
  onCancel: () => void;
}

/** What a dialog adds to its message: a line, in the same grey as the message. */
function Note({ children }: Readonly<{ children: string }>) {
  return <p className="registration-requests__dialog-note">{children}</p>;
}

/** The requests of a selection that the action leaves alone, and why: said before the staff member confirms. */
function leftOut(selected: number, used: number, why: string): string | null {
  const skipped = selected - used;
  if (skipped <= 0) return null;
  return `${skipped} of the selected requests ${skipped === 1 ? "is" : "are"} left out. ${why}`;
}

function AcceptDialog({ rows, busy, error, onConfirm, onCancel }: Readonly<DialogProps & { rows: RegistrationListItemDto[]; onConfirm: () => void }>) {
  const { accept } = selectionActions(rows);
  const seats = seatsNeeded(accept);
  const skipped = leftOut(rows.length, accept.length, "A request that is accepted already, or waits for the guest to confirm the address, cannot be accepted.");
  return (
    <ConfirmDialog
      open
      title={accept.length === 1 ? "Accept this request?" : `Accept ${accept.length} requests?`}
      message={`${accept.length === 1 ? "The guest becomes an attendee" : "Each guest becomes an attendee"} and gets a ticket by email.`}
      errorMessage={error}
      confirmLabel="Accept"
      loading={busy}
      wide
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {seats > accept.length ? <Note>{`They take ${seats} seats, counting the people they bring.`}</Note> : null}
      {skipped ? <Note>{skipped}</Note> : null}
    </ConfirmDialog>
  );
}

function RejectDialog({ rows, busy, error, onConfirm, onCancel }: Readonly<DialogProps & { rows: RegistrationListItemDto[]; onConfirm: (options: { notify: boolean }) => void }>) {
  // Off every time the dialog opens: a guest who is turned down is told only when the staff member chooses to (D-B8).
  const [notify, setNotify] = useState(false);
  const { reject } = selectionActions(rows);
  const one = reject.length === 1;
  const skipped = leftOut(rows.length, reject.length, "A request that is decided already, or waits for the guest to confirm the address, cannot be rejected.");
  return (
    <ConfirmDialog
      open
      title={one ? "Reject this request?" : `Reject ${reject.length} requests?`}
      message={`${one ? "It stays" : "They stay"} on the list as rejected. A guest cannot register again with the same address until you delete the request. You can still accept ${one ? "it" : "them"} later, from this list.`}
      errorMessage={error}
      confirmLabel="Reject"
      loading={busy}
      wide
      onConfirm={() => onConfirm({ notify })}
      onCancel={onCancel}
    >
      <Checkbox
        label={one ? "Send a message to the guest" : "Send a message to the guests"}
        checked={notify}
        disabled={busy}
        onChange={(event) => setNotify(event.target.checked)}
      />
      <Note>{one ? "Off: the guest is not told. On: the guest gets the decline email." : "Off: the guests are not told. On: the guests get the decline email."}</Note>
      {skipped ? <Note>{skipped}</Note> : null}
    </ConfirmDialog>
  );
}

/** Said whenever accepted requests are among those to delete: it erases the attendee too, and what that means. */
function AcceptedWarning({ lead }: Readonly<{ lead: string }>) {
  return (
    <Notice variant="warning">
      <strong>{lead}</strong> The ticket stops working, the wallet pass is removed and the personal data is erased, as with Erase personal data. Reports keep an
      anonymous entry. The seat is freed, unless the guest was checked in already or the event is archived.
    </Notice>
  );
}

function DeleteDialog({ rows, busy, error, onConfirm, onCancel }: Readonly<DialogProps & { rows: RegistrationListItemDto[]; onConfirm: () => void }>) {
  const accepted = acceptedAmong(rows);
  const one = rows.length === 1;
  let lead = "";
  if (accepted > 0) {
    const verb = accepted === 1 ? "is" : "are";
    lead = one
      ? "This request is accepted, so the guest is an attendee. Deleting it also erases the attendee."
      : `${accepted} of these requests ${verb} accepted. Deleting an accepted request also erases the attendee.`;
  }
  return (
    <ConfirmDialog
      open
      title={one ? "Delete this request?" : `Delete ${rows.length} requests?`}
      message={`${one ? "The request and its emails are" : "The requests and their emails are"} removed for good. This cannot be undone. A guest can register again with the same address.`}
      errorMessage={error}
      confirmLabel="Delete"
      confirmVariant="danger"
      loading={busy}
      wide
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {accepted > 0 ? <AcceptedWarning lead={lead} /> : null}
    </ConfirmDialog>
  );
}

function DeleteMatchingDialog({ target, busy, error, onConfirm, onCancel }: Readonly<DialogProps & { target: MatchingTarget; onConfirm: () => void }>) {
  const { status } = target.query;
  // With a state set, we know whether accepted requests are among them; with none, any of them may be.
  let lead = "";
  if (status === "accepted") lead = "All of these requests are accepted. Deleting them also erases their attendees.";
  else if (status === undefined) lead = "Some of these requests may be accepted. Deleting an accepted request also erases the attendee.";
  return (
    <ConfirmDialog
      open
      title={target.total === 1 ? "Delete the request that matches?" : `Delete all ${target.total} requests that match?`}
      message="Every request that matches your filter is removed for good, on every page and not only the ones you see. This cannot be undone."
      errorMessage={error}
      confirmLabel={`Delete ${target.total}`}
      confirmVariant="danger"
      loading={busy}
      wide
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <ul className="confirm-dialog__list">
        {describeFilter(target.query).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {lead ? <AcceptedWarning lead={lead} /> : null}
    </ConfirmDialog>
  );
}

/**
 * The confirmation of whatever is pending, one dialog at a time: it is mounted for as long as it is asked, so each opening starts
 * fresh (the message to a rejected guest is off again). Deleting everything a filter selects shows the numbers of the newest answer
 * of the list, which are the ones it sends.
 */
export function RequestDecisionDialogs({
  pending,
  matching,
  busy,
  error,
  onConfirm,
  onCancel,
}: Readonly<{
  pending: PendingDecision | null;
  matching: MatchingTarget | null;
  busy: PendingDecision["kind"] | "retry" | null;
  error: string | null;
  onConfirm: (options?: { notify?: boolean }) => void;
  onCancel: () => void;
}>) {
  if (pending === null) return null;
  const common = { error, onCancel };
  switch (pending.kind) {
    case "accept":
      return <AcceptDialog {...common} rows={pending.rows} busy={busy === "accept"} onConfirm={() => onConfirm()} />;
    case "reject":
      return <RejectDialog {...common} rows={pending.rows} busy={busy === "reject"} onConfirm={onConfirm} />;
    case "delete":
      return <DeleteDialog {...common} rows={pending.rows} busy={busy === "delete"} onConfirm={() => onConfirm()} />;
    case "deleteMatching":
      return matching ? <DeleteMatchingDialog {...common} target={matching} busy={busy === "deleteMatching"} onConfirm={() => onConfirm()} /> : null;
  }
}
