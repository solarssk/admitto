import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, Input, ModalBackdrop, Notice } from "@admitto/ui";
import { REGISTRATION_PASSWORD_MAX, REGISTRATION_PASSWORD_MIN, registrationPasswordLength } from "@admitto/shared";
import { ApiError, setRegistrationPassword } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { useModalFocusTrap } from "../components/useModalFocusTrap.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import { NO_AUTOFILL_PROPS } from "../utils/no-autofill.js";
import "../attendees/add-attendee-modal.css";

const LENGTH_MESSAGE = `The password needs ${REGISTRATION_PASSWORD_MIN} to ${REGISTRATION_PASSWORD_MAX} characters.`;

const ignore = () => undefined;

/**
 * Sets the password of the event, or changes it. It is hidden as it is typed, with a button to show it, because there is no
 * second chance to read it: the password is checked here for its length only and goes to the server in the body of one request,
 * never in an address, and the server never sends it back. A click outside does not close the dialog (what was typed would be
 * lost); Cancel and Escape do, and none of them while the request runs.
 */
export function EventPasswordDialog({
  open,
  eventId,
  hasPassword,
  onClose,
  onSaved,
}: Readonly<{
  open: boolean;
  eventId: string;
  /** A password is set already: this one replaces it. */
  hasPassword: boolean;
  onClose: () => void;
  /** The password was saved. */
  onSaved: () => void;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useModalFocusTrap(panelRef, open, saving ? ignore : onClose);

  // A password that was typed is not kept: not after the dialog closes, and not for the next time it opens.
  useEffect(() => {
    setValue("");
    setShown(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const length = registrationPasswordLength(value);
    if (length < REGISTRATION_PASSWORD_MIN || length > REGISTRATION_PASSWORD_MAX) {
      setError(LENGTH_MESSAGE);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setRegistrationPassword(eventId, value);
      setValue("");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      setError(operatorApiErrorMessage(err, "Could not save the password."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog className="add-attendee-modal" open aria-modal="true" aria-labelledby={titleId}>
      <ModalBackdrop />
      <div className="add-attendee-modal__panel add-attendee-modal__panel--w420" ref={panelRef}>
        <form className="add-attendee-modal__scroll at-scroll" onSubmit={(event) => void submit(event)}>
          <h2 className="add-attendee-modal__title" id={titleId}>
            {hasPassword ? "Change the event password" : "Set the event password"}
          </h2>
          <p className="add-attendee-modal__hint">
            Guests enter this password before they see the form. You cannot read it again after you save it, so keep a copy to share with them.
          </p>
          <Input
            label="Password"
            type={shown ? "text" : "password"}
            {...NO_AUTOFILL_PROPS}
            value={value}
            readOnly={saving}
            invalid={error !== null}
            hint={`${REGISTRATION_PASSWORD_MIN} to ${REGISTRATION_PASSWORD_MAX} characters. Guests type it exactly as you do, spaces included.`}
            icon={<i className={`ti ti-${shown ? "eye-off" : "eye"}`} />}
            iconLabel={shown ? "Hide the password" : "Show the password"}
            onIconClick={() => setShown((current) => !current)}
            autoFocus
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {error && (
            <Notice variant="error" role="alert">
              {error}
            </Notice>
          )}
          <div className="add-attendee-modal__actions">
            <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              Save password
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
