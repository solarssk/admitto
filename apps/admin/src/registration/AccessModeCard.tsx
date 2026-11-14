import { useId, type ReactNode } from "react";
import { Card } from "@admitto/ui";
import type { RegistrationMode } from "@admitto/db/status";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import "./registration-access.css";

type ModeChoice = "off" | RegistrationMode;

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<ModeChoice>> = [
  { value: "off", label: "Off" },
  { value: "automatic", label: "Automatic" },
  { value: "approval", label: "With approval" },
];

/** What each mode does, in a sentence under the control (D-B1, D-B5). */
const MODE_HINTS: Readonly<Record<ModeChoice, string>> = {
  off: "Guests cannot open the form. The requests you already have stay on the Requests tab.",
  automatic: "Guests are accepted without waiting for you, until the event is full.",
  approval: "Every request waits on the Requests tab until you accept or reject it.",
};

/**
 * Whether registration is on for the event, and in which mode: off, accepting guests by itself, or waiting for the organiser's
 * decision. The two modes that are on are off the table while the event is not ready (the checklist below says what is missing), and
 * the reason is the text under the control. Turning registration off is always possible. The link guests use is the `children`.
 */
export function AccessModeCard({
  mode,
  canTurnOn,
  unsaved,
  disabled,
  onChange,
  children,
}: Readonly<{
  mode: RegistrationMode | null;
  /** Registration may be turned on: the event is ready, or already has it on (a move between the two modes is never refused). */
  canTurnOn: boolean;
  /** The form holds changes that are not saved, which the checklist does not know about yet. */
  unsaved: boolean;
  disabled: boolean;
  onChange: (mode: RegistrationMode | null) => void;
  children: ReactNode;
}>) {
  const reasonId = useId();
  const choice: ModeChoice = mode ?? "off";
  const options = MODE_OPTIONS.map((option) => (option.value === "off" ? option : { ...option, disabled: !canTurnOn }));
  return (
    <Card title="Guest registration">
      <div className="settings-card-stack">
        <Segmented
          className="access-seg"
          ariaLabel="Registration mode"
          describedBy={canTurnOn ? undefined : reasonId}
          options={options}
          value={choice}
          disabled={disabled}
          onChange={(next) => onChange(next === "off" ? null : next)}
        />
        <p className="settings-card-intro">{MODE_HINTS[choice]}</p>
        {!canTurnOn && (
          <p className="settings-card-intro" id={reasonId}>
            Registration can be turned on when the checklist below is done.{unsaved ? " Save your changes first: the checklist shows what is saved." : ""}
          </p>
        )}
        {children}
      </div>
    </Card>
  );
}
