import { useState, type FormEvent } from "react";
import { Button, Card, Input } from "@admitto/ui";
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
            <Input
              id="device-label-field"
              label="Device label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Tablet 1, main entrance"
              maxLength={120}
              autoComplete="off"
              disabled={busy}
              hint={detectedLabel ? "Detected from your browser. Edit if needed." : undefined}
              error={error ?? undefined}
            />
            <div className="at-row at-row--gap">
              <Button type="button" variant="ghost" disabled={busy} onClick={onSkip}>
                Continue without label
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Continue"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
