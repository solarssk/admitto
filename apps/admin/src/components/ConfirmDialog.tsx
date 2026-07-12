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
  /**
   * When set, the confirm button stays disabled for this many seconds after the dialog opens,
   * with a thin depleting progress bar shown under its label (button height/size unchanged).
   * A brief "don't act on reflex" pause for especially impactful bulk actions, on top of the
   * dialog itself. Restarts every time the dialog re-opens.
   */
  confirmDelaySeconds?: number;
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
  confirmDelaySeconds,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [typedValue, setTypedValue] = useState("");
  const [armed, setArmed] = useState(confirmDelaySeconds === undefined);
  useModalFocusTrap(panelRef, open, onCancel);

  useEffect(() => {
    if (open) setTypedValue("");
  }, [open]);

  useEffect(() => {
    if (!open || confirmDelaySeconds === undefined) return;
    setArmed(false);
    const timer = window.setTimeout(() => setArmed(true), confirmDelaySeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [open, confirmDelaySeconds]);

  if (!open) return null;

  const needsTypedConfirmation = confirmationValue !== undefined;
  // An empty confirmationValue can never be "typed" to confirm — fail closed rather than
  // let the confirm button unlock immediately (typedValue also starts as "").
  const confirmDisabled =
    loading ||
    !armed ||
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
        <div className="confirm-dialog__actions">
          <Button type="button" variant="secondary" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <span className="confirm-dialog__confirm-wrap">
            <Button
              type="button"
              variant={confirmVariant}
              disabled={confirmDisabled}
              title={
                !armed && confirmDelaySeconds !== undefined
                  ? `Please wait ${confirmDelaySeconds}s before confirming`
                  : undefined
              }
              onClick={onConfirm}
            >
              {loading ? "Working…" : confirmLabel}
            </Button>
            {!armed && confirmDelaySeconds !== undefined && (
              <span className="confirm-dialog__arm-track" aria-hidden="true">
                <span
                  className="confirm-dialog__arm-bar"
                  style={{ animationDuration: `${confirmDelaySeconds}s` }}
                />
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
