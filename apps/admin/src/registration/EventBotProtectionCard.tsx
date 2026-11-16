import { useState } from "react";
import { Card, HintLabel, Notice, Switch } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

const CARD_HINT = "Keeps bots out of the registration form of this event. The organisation's keys and switch are in Organisation settings, External services.";
const INTRO = "Asks a visitor to prove they are not a bot before the form is sent. It is used on the link and password forms of this event.";
const OFF_NOTICE = "Without the check, bots can fill in the form. The link and password forms of this event have no bot check.";
const SSO_NOTE = "This event uses Company SSO, which does not use the bot check, because guests sign in first. The switch is off while the event uses it.";
const CONFIRM_MESSAGE =
  "After you save, guests of this event are not checked for bots. For an event that needs strong protection, use Company SSO or a strong event password.";

/**
 * Event settings, Registration: the bot check of this event, for a superadmin. It is shown only while the organisation's own switch is
 * on; with the organisation's off there is no check anywhere. On is the default. The change is part of the draft of the tab and is saved
 * with its Save. Turning it off asks first. Company SSO has no check, so for it the switch is greyed, with a sentence that says why, and keeps its value.
 */
export function EventBotProtectionCard({
  enabled,
  usesSso,
  disabled,
  onChange,
}: Readonly<{
  enabled: boolean;
  /** The event's access method is Company SSO: it never has a bot check. */
  usesSso: boolean;
  /** True while a save runs, for an archived event: a change made now would be lost. */
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card
      title={<HintLabel hint={CARD_HINT}>Bot protection</HintLabel>}
      actions={
        <Switch
          id="event-bot-protection-enabled"
          label={enabled ? "On" : "Off"}
          checked={enabled}
          disabled={disabled || usesSso}
          onChange={(event) => (event.target.checked ? onChange(true) : setConfirming(true))}
        />
      }
    >
      <div className="settings-card-stack">
        <p className="settings-card-intro">{INTRO}</p>
        {usesSso && <Notice variant="info">{SSO_NOTE}</Notice>}
        {!enabled && !usesSso && <Notice variant="warning">{OFF_NOTICE}</Notice>}
      </div>
      <ConfirmDialog
        open={confirming}
        icon={<i className="ti ti-shield-off" />}
        title="Turn bot protection off for this event?"
        message={CONFIRM_MESSAGE}
        confirmLabel="Turn off"
        onConfirm={() => {
          setConfirming(false);
          onChange(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
