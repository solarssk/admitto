import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@admitto/ui";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";

export interface CreateTemplateDialogProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (label: string) => void;
}

/** Modal for naming a new event-scoped mail template. */
export function CreateTemplateDialog({ open, busy, onClose, onCreate }: CreateTemplateDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useModalFocusTrap(panelRef, open, onClose);

  useEffect(() => {
    if (!open) return;
    setLabel("");
    setError(null);
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Enter a template label.");
      return;
    }
    onCreate(trimmed);
  };

  return (
    <div className="add-attendee-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="add-attendee-modal__backdrop" role="presentation" onClick={busy ? undefined : onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          New template
        </h2>
        <Input
          label="Template label"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          autoFocus
        />
        {error && (
          <p className="add-attendee-modal__error" role="alert">
            {error}
          </p>
        )}
        <div className="add-attendee-modal__actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={submit}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}
