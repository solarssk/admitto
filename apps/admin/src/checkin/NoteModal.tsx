import { useRef, useState } from "react";
import { Button } from "@admitto/ui";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./note-modal.css";

type NoteModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: string) => Promise<void>;
};

export function NoteModal({ open, onClose, onSubmit }: NoteModalProps) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = () => { setValue(""); onClose(); };

  useModalFocusTrap(panelRef, open, handleClose);

  if (!open) return null;

  const handleSubmit = async () => {
    const body = value.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(body);
      setValue("");
      onClose();
    } catch {
      // onSubmit already surfaced the error; keep modal open so operator can retry
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="note-modal" role="dialog" aria-modal="true" aria-label="Add note">
      <div className="note-modal__backdrop" role="presentation" onClick={handleClose} />
      <div ref={panelRef} className="note-modal__panel">
        <p id="note-modal-hint" className="note-modal__hint">
          Do not record medical, dietary, or other sensitive personal data.
        </p>
        <textarea
          aria-describedby="note-modal-hint"
          className="note-modal__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Add a note…"
          disabled={submitting}
        />
        <span className="note-modal__counter">{value.length} / 2000</span>
        <div className="note-modal__actions">
          <Button type="button" variant="secondary" disabled={submitting} onClick={handleClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!value.trim() || submitting} onClick={handleSubmit}>
            {submitting ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
