import { useId, useRef } from "react";
import { Button } from "@admitto/ui";
import { useModalFocusTrap } from "./useModalFocusTrap.js";
import "./confirm-dialog.css";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Accessible confirmation modal replacing native window.confirm. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, open, onCancel);

  if (!open) return null;

  return (
    <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="confirm-dialog__backdrop" role="presentation" onClick={onCancel} />
      <div ref={panelRef} className="confirm-dialog__panel">
        <h3 id={titleId} className="confirm-dialog__title">
          {title}
        </h3>
        <p className="confirm-dialog__message">{message}</p>
        <div className="confirm-dialog__actions">
          <Button type="button" variant="secondary" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
