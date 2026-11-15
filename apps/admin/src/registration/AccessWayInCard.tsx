import { useId, useState } from "react";
import { Button, Card, Notice, useToast } from "@admitto/ui";
import { ApiError, clearRegistrationPassword } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import type { AccessMethod } from "./accessSettings.js";
import { EventPasswordDialog } from "./EventPasswordDialog.js";
import "./registration-access.css";

const METHOD_OPTIONS: ReadonlyArray<SegmentedOption<AccessMethod>> = [
  { value: "link", label: "Link" },
  { value: "password", label: "Password" },
  { value: "sso", label: "Company SSO" },
];

/** What the chosen way means, in one notice under the choice. */
const BOT_CHECK = " A bot check protects the form.";
function methodNotice(method: AccessMethod, botCheck: boolean): string {
  if (method === "sso") return "Guests sign in with the company's single sign-on (SSO), using their work account. Their email comes from that sign-in.";
  const text = method === "link" ? "Anyone who has the link can ask to join." : "Guests need the link and the event password to open the form.";
  return botCheck ? text + BOT_CHECK : text;
}

/** Why a way is off, in the tooltip of its button: the superadmin is told where to turn it on, the organiser to ask. */
const NOT_TURNED_ON = "This way is not turned on for your organisation.";
const REASON_FOR_SUPERADMIN = `${NOT_TURNED_ON} Turn it on in Organisation settings, External services, Access methods.`;
const REASON_FOR_ORGANISER = `${NOT_TURNED_ON} Ask a superadmin to turn it on.`;

/** The shared password of the event: whether one is set, and the buttons to set, change or remove it. It never shows the password. */
function EventPasswordRow({
  event,
  passwordSet,
  disabled,
  onSet,
  onRemove,
}: Readonly<{ event: EventDto; passwordSet: boolean; disabled: boolean; onSet: () => void; onRemove: () => void }>) {
  const id = useId();
  return (
    <div className="settings-row settings-row--switch access-password">
      <div className="settings-row__text">
        <strong>Event password</strong>
        <p>
          {passwordSet
            ? "A password is set. Guests need it to open the form. You cannot read it again, so keep a copy to share with them."
            : "No password is set. Guests cannot open the form without one."}
        </p>
      </div>
      <div className="settings-row__controls">
        <ArchivedGuard event={event} reasonId={`${id}-set`} disabled={disabled}>
          {(guard) => (
            <Button type="button" variant="secondary" {...guard} onClick={onSet}>
              {passwordSet ? "Change" : "Set"}
            </Button>
          )}
        </ArchivedGuard>
        {passwordSet && (
          <ArchivedGuard event={event} reasonId={`${id}-remove`} disabled={disabled}>
            {(guard) => (
              <Button type="button" variant="ghost" {...guard} onClick={onRemove}>
                Remove
              </Button>
            )}
          </ArchivedGuard>
        )}
      </div>
    </div>
  );
}

/**
 * How guests open the form: with the link, with a password that the organiser sets, or by signing in with the company's identity
 * provider (which can be limited to the people of one company). One way in at a time. The password has
 * its own requests (it is not one of the settings that the Save of the page sends): it is set, changed and removed from here, and
 * the page learns of it through `onPasswordChanged`.
 */
export function AccessWayInCard({
  eventId,
  event,
  method,
  savedMethod,
  passwordSet,
  enabledMethods,
  botCheck,
  isSuperadmin,
  disabled,
  onMethodChange,
  onPasswordChanged,
  onArchived,
}: Readonly<{
  eventId: string;
  event: EventDto;
  /** The way in the form holds now, and the one that is saved. */
  method: AccessMethod | null;
  savedMethod: AccessMethod | null;
  passwordSet: boolean;
  /** The ways in a superadmin has turned on for the organisation. The others cannot be chosen. */
  enabledMethods: readonly AccessMethod[];
  /** The organisation checks guests for bots on the link and password forms (a superadmin has not switched it off). */
  botCheck: boolean;
  /** A superadmin is told where to turn a way in on. */
  isSuperadmin: boolean;
  disabled: boolean;
  onMethodChange: (method: AccessMethod) => void;
  onPasswordChanged: (isSet: boolean) => void;
  /** A change of the password was refused because the event is archived: the page reads the event and the settings again. */
  onArchived: () => void;
}>) {
  const { addToast } = useToast();
  // A way that is not turned on is greyed, also the one the event has chosen: it stays chosen, nothing is removed. Its reason is a tooltip.
  const reason = isSuperadmin ? REASON_FOR_SUPERADMIN : REASON_FOR_ORGANISER;
  const options = METHOD_OPTIONS.map((option) =>
    enabledMethods.includes(option.value) ? option : { ...option, disabled: true, tooltip: reason },
  );
  // The way the person pressed while a password is set: it waits for the answer of the dialog, and the choice stays as it was until then.
  const [leaving, setLeaving] = useState<AccessMethod | null>(null);
  const [setOpen, setSetOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /** Nothing is left to confirm or to type: the dialog is gone, the page reads the event again so that its controls lock, and a toast says why. */
  function archived(message: string) {
    onArchived();
    addToast(message, "error");
  }

  /** Leaving the password removes it when the page is saved: the person is asked before the choice changes. */
  function choose(next: AccessMethod) {
    // The password is removed by the save of the page, and only an event that is saved with it has one to lose.
    if (passwordSet && savedMethod === "password" && method === "password" && next !== "password") setLeaving(next);
    else onMethodChange(next);
  }

  async function remove() {
    // The button of the confirmation is busy while the removal runs, so a second press never gets here.
    /* v8 ignore if */
    if (removing) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await clearRegistrationPassword(eventId);
      setRemoveOpen(false);
      addToast("Password removed.", "success");
      onPasswordChanged(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      const message = operatorApiErrorMessage(err, "Could not remove the password.");
      if (hasApiErrorCode(err, "event_archived")) {
        setRemoveOpen(false);
        archived(message);
      } else setRemoveError(message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card title="How guests open the form">
      <div className="settings-card-stack">
        <p className="settings-card-intro">Choose how guests open the registration form.</p>
        <Segmented
          className="access-seg"
          ariaLabel="How guests open the form"
          options={options}
          value={method}
          disabled={disabled}
          onChange={choose}
        />
        {method !== null && <Notice variant="info">{methodNotice(method, botCheck)}</Notice>}
        {method === "password" && (
          <EventPasswordRow event={event} passwordSet={passwordSet} disabled={disabled} onSet={() => setSetOpen(true)} onRemove={() => setRemoveOpen(true)} />
        )}
      </div>
      <EventPasswordDialog
        open={setOpen}
        eventId={eventId}
        hasPassword={passwordSet}
        onClose={() => setSetOpen(false)}
        onArchived={archived}
        onSaved={() => {
          setSetOpen(false);
          addToast("Password saved.", "success");
          onPasswordChanged(true);
        }}
      />
      <ConfirmDialog
        open={leaving !== null}
        title="Remove the event password?"
        message="If you choose another way and save, the event password is deleted. To use a password again, you must set a new one."
        confirmLabel="Remove"
        onConfirm={() => {
          if (leaving !== null) onMethodChange(leaving);
          setLeaving(null);
        }}
        onCancel={() => setLeaving(null)}
      />
      <ConfirmDialog
        open={removeOpen}
        title="Remove the event password?"
        message="Guests cannot open the form until you set a new password. You cannot read the old one again."
        confirmLabel="Remove"
        confirmVariant="danger"
        errorMessage={removeError}
        loading={removing}
        onConfirm={() => void remove()}
        onCancel={() => {
          setRemoveOpen(false);
          setRemoveError(null);
        }}
      />
    </Card>
  );
}
