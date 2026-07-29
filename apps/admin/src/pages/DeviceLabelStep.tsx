import { useState, type FormEvent } from "react";
import { Card } from "@admitto/ui";
import { submitSessionDeviceLabel } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { parseDeviceName } from "../utils/parseDeviceName.js";
import { BrandMark } from "../layouts/BrandMark.js";
import "./device-label-step.css";

type DeviceLabelStepProps = {
  onSaved: () => void | Promise<void>;
  onSkip: () => void;
};

/** Post-login step: optional device label for operator sessions (prefilled from UA). */
export function DeviceLabelStep({ onSaved, onSkip }: Readonly<DeviceLabelStepProps>) {
  const detectedLabel = parseDeviceName();
  const [label, setLabel] = useState(() => detectedLabel);
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
      setError(operatorApiErrorMessage(err, "Could not save device label."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="device-gate">
      <div className="device-gate__shell">
        <Card>
          <div className="device-gate__brand" aria-label="Admitto">
            <BrandMark className="device-gate__brand-mark" />
            <span>Admitto</span>
          </div>
          <h1 className="device-gate__title">Device label</h1>
          <p className="device-gate__subtitle">
            Name this tablet or scanner so check-in undo and session lists stay identifiable on
            event day.
          </p>
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
                placeholder="Tablet 1, main entrance"
                maxLength={120}
                autoComplete="off"
                disabled={busy}
              />
              {detectedLabel && (
                <p className="at-hint">Detected from your browser. Edit if needed.</p>
              )}
            </div>
            {error && (
              <p className="text-error" role="alert">
                {error}
              </p>
            )}
            <div className="at-row at-row--gap">
              <button type="button" className="at-btn at-btn--ghost" disabled={busy} onClick={onSkip}>
                Continue without label
              </button>
              <button type="submit" className="at-btn at-btn--primary" disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
