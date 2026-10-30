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
];

const METHOD_HINTS: Readonly<Record<AccessMethod, string>> = {
  link: "Anyone who has the link can ask to join. A bot check protects the form.",
  password: "Guests must type the event password to open the form. A bot check protects it too.",
};

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
              {passwordSet ? "Change password" : "Set password"}
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
 * How guests open the form: with the link, or with a password that the organiser sets. One way in at a time. The password has
 * its own requests (it is not one of the settings that the Save of the page sends): it is set, changed and removed from here, and
 * the page learns of it through `onPasswordChanged`.
 */
export function AccessWayInCard({
  eventId,
  event,
  method,
  savedMethod,
  passwordSet,
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
  disabled: boolean;
  onMethodChange: (method: AccessMethod) => void;
  onPasswordChanged: (isSet: boolean) => void;
  /** A change of the password was refused because the event is archived: the page reads the event and the settings again. */
  onArchived: () => void;
}>) {
  const { addToast } = useToast();
  const [setOpen, setSetOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /** Nothing is left to confirm or to type: the dialog is gone, the page reads the event again so that its controls lock, and a toast says why. */
  function archived(message: string) {
    onArchived();
    addToast(message, "error");
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
    <Card title="Way in">
      <div className="settings-card-stack">
        <Segmented
          className="access-seg"
          ariaLabel="Way in"
          options={METHOD_OPTIONS}
          value={method}
          disabled={disabled}
          onChange={onMethodChange}
        />
        {method === null ? (
          <p className="settings-card-intro">Choose how guests open the form. You can use one way in at a time.</p>
        ) : (
          <p className="settings-card-intro">{METHOD_HINTS[method]}</p>
        )}
        {method === "password" && (
          <>
            <EventPasswordRow event={event} passwordSet={passwordSet} disabled={disabled} onSet={() => setSetOpen(true)} onRemove={() => setRemoveOpen(true)} />
            <p className="settings-card-intro">Choosing another way in later removes the password.</p>
          </>
        )}
        {savedMethod === "password" && method !== "password" && passwordSet && (
          <Notice variant="warning">Saving removes the event password. A new one has to be set if you choose the password again.</Notice>
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
        open={removeOpen}
        title="Remove the event password?"
        message="Guests cannot open the form until you set a new password. You cannot read the old one again."
        confirmLabel="Remove password"
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
