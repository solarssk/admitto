import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { updateSessionDeviceLabel } from "../../api/client.js";
import { operatorApiErrorMessage } from "../../api/operator-api-error.js";
import type { SessionListDto } from "../../api/types.js";
import { useModalFocusTrap } from "../../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../../hooks/useOverscrollBounceGuard.js";
import "../../attendees/add-attendee-modal.css";

export interface DeviceLabelEditModalProps {
  readonly open: boolean;
  readonly session: SessionListDto | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** Correct a session's device label - a plain, reversible edit (unlike Revoke), so it gets its
 * own small modal rather than ConfirmDialog, which the staff UI reserves for destructive or
 * irreversible confirmations (AGENTS.md, CodeRabbit review). Shape matches this app's other
 * single-field edit modals (UserEditModal, FontFamilyModal): its own dialog/backdrop/focus trap,
 * an inline error (the user's attention is already on this modal, same convention as
 * UserEditModal's own save failures), and Cancel/Save disabled while saving. */
export function DeviceLabelEditModal({ open, session, onClose, onSaved }: Readonly<DeviceLabelEditModalProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setValue(session.deviceLabel ?? "");
    setError(null);
  }, [session]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  useModalFocusTrap(panelRef, open, handleClose);

  if (!open || !session) return null;

  const trimmed = value.trim();
  const unchanged = trimmed === (session.deviceLabel ?? "");

  const handleSave = async () => {
    if (submitting || unchanged) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateSessionDeviceLabel(session.id, trimmed.length > 0 ? trimmed : null);
      onSaved();
      onClose();
    } catch (err) {
      setError(operatorApiErrorMessage(err, "Failed to update device label."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog open className="add-attendee-modal" aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={handleClose} />
      <div ref={panelRef} className="add-attendee-modal__panel" style={{ width: "min(94vw, 420px)" }}>
      <div ref={scrollRef} className="add-attendee-modal__scroll">
        <h2 className="add-attendee-modal__title" id={titleId}>
          <i className="ti ti-pencil" aria-hidden="true" /> Edit device label
        </h2>
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <p className="add-attendee-modal__hint">
          Correct the device label for {session.userEmail}
          {session.deviceLabel ? ` (currently "${session.deviceLabel}")` : ""}.
        </p>
        <Input
          label="Device label"
          value={value}
          disabled={submitting}
          onChange={(e) => setValue(e.target.value)}
          maxLength={120}
          placeholder="Tablet 1, main entrance"
          autoComplete="off"
        />
        <div className="add-attendee-modal__actions" style={{ justifyContent: "flex-end" }}>
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={submitting || unchanged} onClick={() => void handleSave()}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      </div>
    </dialog>
  );
}
