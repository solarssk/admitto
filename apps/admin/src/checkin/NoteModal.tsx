import { useRef, useState } from "react";
import { Button } from "@admitto/ui";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import "./note-modal.css";

type NoteModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: string) => void;
};

export function NoteModal({ open, onClose, onSubmit }: NoteModalProps) {
  const [value, setValue] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  const handleSubmit = () => {
    onSubmit(value.trim());
    setValue("");
    onClose();
  };

  return (
    <div className="note-modal" role="dialog" aria-modal="true" aria-label="Add note">
      <div className="note-modal__backdrop" role="presentation" onClick={onClose} />
      <div ref={panelRef} className="note-modal__panel">
        <textarea
          className="note-modal__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Add a note…"
        />
        <span className="note-modal__counter">{value.length} / 2000</span>
        <div className="note-modal__actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!value.trim()} onClick={handleSubmit}>
            Add note
          </Button>
        </div>
      </div>
    </div>
  );
}
