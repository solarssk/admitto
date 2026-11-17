import { useId, useState } from "react";
import { HintLabel, Notice, Switch, Tooltip } from "@admitto/ui";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import "./registration-access.css";

const HINT = "Keeps bots out of the registration form of this event. The organisation's keys and switch are in Organisation settings, External services.";
const DESCRIPTION = "Asks a visitor to prove they are not a bot before the form is sent. Used on the link and password forms of this event.";
const OFF_NOTICE = "Without the check, bots can fill in the form. The link and password forms of this event have no bot check.";
const SSO_NOTE = "This event uses Company SSO, which does not use the bot check, because guests sign in first. The switch is off while the event uses it.";
const ORG_OFF = "Bot protection is turned off for the whole organisation.";
const CONFIRM_MESSAGE =
  "After you save, guests of this event are not checked for bots. For an event that needs strong protection, use Company SSO or a strong event password.";

/**
 * Event settings, Registration, inside the Access method card: the bot check of this event, for a superadmin, as a switch row like the
 * ones of the Form card, under the notice of the method. With the organisation's own switch off there is no check anywhere: the switch
 * shows Off and is greyed, with a tooltip that says why (as the greyed Company SSO option), and the value stored for the event is not
 * touched or sent. On is the default. The change is part of the draft of the tab and is saved with its Save. Turning it off asks first.
 * Company SSO has no check, so for it the switch is greyed, with a sentence that says why, and keeps its value.
 */
export function EventBotProtectionRow({
  organisationOn,
  enabled,
  usesSso,
  disabled,
  onChange,
}: Readonly<{
  /** The organisation's own switch is on: only then does the event's switch count and can it be changed. */
  organisationOn: boolean;
  enabled: boolean;
  /** The event's access method is Company SSO: it never has a bot check. */
  usesSso: boolean;
  /** True while a save runs, for an archived event: a change made now would be lost. */
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}>) {
  const [confirming, setConfirming] = useState(false);
  const noteId = useId();
  const shown = organisationOn && enabled;
  const sw = (
    <Switch
      id="event-bot-protection-enabled"
      label={shown ? "On" : "Off"}
      checked={shown}
      aria-describedby={organisationOn ? undefined : noteId}
      disabled={disabled || usesSso || !organisationOn}
      onChange={(event) => (event.target.checked ? onChange(true) : setConfirming(true))}
    />
  );
  return (
    <div className="access-bot">
      <div className="settings-row settings-row--switch">
        <div className="settings-row__text">
          <strong>
            <HintLabel hint={HINT}>Bot protection</HintLabel>
          </strong>
          <p>{DESCRIPTION}</p>
        </div>
        {organisationOn ? (
          sw
        ) : (
          <Tooltip content={ORG_OFF}>
            {sw}
            <span id={noteId} className="sr-only">
              {ORG_OFF}
            </span>
          </Tooltip>
        )}
      </div>
      {organisationOn && usesSso && <Notice variant="info">{SSO_NOTE}</Notice>}
      {organisationOn && !enabled && !usesSso && <Notice variant="warning">{OFF_NOTICE}</Notice>}
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
    </div>
  );
}
