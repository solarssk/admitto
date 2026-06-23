import { useState, type FormEvent } from "react";
import { Card, PageHeader } from "@admitto/ui";
import { ApiError, submitSessionDeviceLabel } from "../api/client.js";

type DeviceLabelStepProps = {
  onSaved: () => void | Promise<void>;
  onSkip: () => void;
};

export function DeviceLabelStep({ onSaved, onSkip }: DeviceLabelStepProps) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Enter a device label or continue without one.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitSessionDeviceLabel(trimmed);
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save device label.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <PageHeader
        title="Device label"
        subtitle="Name this tablet or scanner so check-in undo and session lists stay identifiable on event day."
      />
      <form className="at-stack" onSubmit={(e) => void onSubmit(e)}>
        <div className="at-field">
          <label className="at-label" htmlFor="device-label-field">
            Device label
          </label>
          <input
            id="device-label-field"
            className="at-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Tablet 1 — main entrance"
            maxLength={120}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        {error && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}
        <div className="at-row at-row--gap">
          <button type="submit" className="at-btn at-btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Continue"}
          </button>
          <button type="button" className="at-btn at-btn--ghost" disabled={busy} onClick={onSkip}>
            Continue without label
          </button>
        </div>
      </form>
    </Card>
  );
}
