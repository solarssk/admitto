import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, ModalBackdrop } from "@admitto/ui";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { useOverscrollBounceGuard } from "../hooks/useOverscrollBounceGuard.js";

/** Props for {@link CreateTemplateDialog}. */
export interface CreateTemplateDialogProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (label: string) => void;
}

/** Modal for naming a new event-scoped mail template. */
export function CreateTemplateDialog({
  open,
  busy,
  onClose,
  onCreate,
}: Readonly<CreateTemplateDialogProps>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverscrollBounceGuard(scrollRef, open);
  const submittingRef = useRef(false);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useModalFocusTrap(panelRef, open, onClose);

  useEffect(() => {
    if (!open) {
      submittingRef.current = false;
      return;
    }
    setLabel("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!busy) submittingRef.current = false;
  }, [busy]);

  if (!open) return null;

  const submit = () => {
    if (busy || submittingRef.current) return;
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Enter a template label.");
      return;
    }
    submittingRef.current = true;
    onCreate(trimmed);
  };

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop onClose={busy ? undefined : onClose} />
      <div className="add-attendee-modal__panel" ref={panelRef}>
      <div className="add-attendee-modal__scroll" ref={scrollRef}>
        <h2 className="add-attendee-modal__title" id={titleId}>
          New template
        </h2>
        <p className="add-attendee-modal__hint">
          Creates a new, blank template for this event. Give it a short label to find it in the
          picker later. You'll write the subject and body next.
        </p>
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
    </dialog>
  );
}
