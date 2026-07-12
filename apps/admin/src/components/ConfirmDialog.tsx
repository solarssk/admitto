import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@admitto/ui";
import { useModalFocusTrap } from "./useModalFocusTrap.js";
import "./confirm-dialog.css";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  errorMessage?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  loading?: boolean;
  /**
   * When set, the confirm button stays disabled until the user types this exact
   * (case-sensitive) value into the extra input rendered above the actions. Used for
   * irreversible actions (e.g. permanently deleting an event) as a "drunk click" /
   * compromised-session safeguard beyond the dialog itself.
   */
  confirmationValue?: string;
  /** Label for the typed-confirmation input. Defaults to a generic "Type X to confirm" hint. */
  confirmationLabel?: string;
  /** Extra fields rendered between the error message and the action buttons (e.g. a step-up code input). */
  children?: ReactNode;
  /** External confirm-disabled condition (e.g. a required field in `children` is still empty), ORed with the built-in checks. */
  disableConfirm?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Accessible confirmation modal replacing native window.confirm. */
export function ConfirmDialog({
  open,
  title,
  message,
  errorMessage,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "primary",
  loading = false,
  confirmationValue,
  confirmationLabel,
  children,
  disableConfirm = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [typedValue, setTypedValue] = useState("");
  useModalFocusTrap(panelRef, open, onCancel);

  useEffect(() => {
    if (open) setTypedValue("");
  }, [open]);

  if (!open) return null;

  const needsTypedConfirmation = confirmationValue !== undefined;
  // An empty confirmationValue can never be "typed" to confirm — fail closed rather than
  // let the confirm button unlock immediately (typedValue also starts as "").
  const confirmDisabled =
    loading ||
    disableConfirm ||
    (needsTypedConfirmation && (!confirmationValue || typedValue !== confirmationValue));

  return (
    <div
      className="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="confirm-dialog__backdrop" role="presentation" onClick={onCancel} />
      <div ref={panelRef} className="confirm-dialog__panel">
        <h3 id={titleId} className="confirm-dialog__title">
          {title}
        </h3>
        <p id={descriptionId} className="confirm-dialog__message">
          {message}
        </p>
        {errorMessage && (
          <p className="confirm-dialog__error" role="alert">
            {errorMessage}
          </p>
        )}
        {needsTypedConfirmation && (
          <Input
            label={confirmationLabel ?? `Type "${confirmationValue}" to confirm`}
            value={typedValue}
            disabled={loading}
            autoComplete="off"
            onChange={(e) => setTypedValue(e.target.value)}
          />
        )}
        {children}
        <div className="confirm-dialog__actions">
          <Button type="button" variant="secondary" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
