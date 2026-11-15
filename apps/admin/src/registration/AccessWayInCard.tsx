import { useId, useState } from "react";
import { Button, Card, Notice, useToast } from "@admitto/ui";
import { ApiError, clearRegistrationPassword } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto, RegistrationSettingsDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import type { AccessMethod } from "./accessSettings.js";
import { AccessSsoProvider } from "./AccessSsoProvider.js";
import { EventPasswordDialog } from "./EventPasswordDialog.js";
import { NO_PROVIDER_FOR_ORGANISER, NO_PROVIDER_FOR_SUPERADMIN } from "./ssoProviderChoice.js";
import "./registration-access.css";

const METHOD_OPTIONS: ReadonlyArray<SegmentedOption<AccessMethod>> = [
  { value: "link", label: "Link" },
  { value: "password", label: "Password" },
  { value: "sso", label: "Company SSO" },
];

/** What the chosen method means, in one notice under the choice. Company SSO says it under its provider, which has a notice of its own. */
const BOT_CHECK = " A bot check protects the form.";
function methodNotice(method: Exclude<AccessMethod, "sso">, botCheck: boolean): string {
  const text = method === "link" ? "Anyone who has the link can ask to join." : "Guests need the link and the event password to open the form.";
  return botCheck ? text + BOT_CHECK : text;
}

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
 * How guests open the form, the access method: the link, a password that the organiser sets, or a sign-in with an identity provider
 * (Company SSO, which can be limited to the people of one company). One at a time. The password has its own requests (it is not one of the settings that the Save of the page sends): it is set, changed and removed from here, and
 * the page learns of it through `onPasswordChanged`.
 */
export function AccessWayInCard({
  eventId,
  event,
  method,
  savedMethod,
  passwordSet,
  providers,
  currentProvider,
  providerId,
  savedProviderId,
  providerLocked,
  botCheck,
  isSuperadmin,
  disabled,
  onMethodChange,
  onProviderChange,
  onPasswordChanged,
  onArchived,
}: Readonly<{
  eventId: string;
  event: EventDto;
  /** The way in the form holds now, and the one that is saved. */
  method: AccessMethod | null;
  savedMethod: AccessMethod | null;
  passwordSet: boolean;
  /** The identity providers Company SSO can use, and the one this event has saved. Company SSO is off while there is none to use. */
  providers: RegistrationSettingsDto["sso_providers"];
  currentProvider: RegistrationSettingsDto["sso_provider"];
  /** The identity provider in the form, and the one that is saved. */
  providerId: string | null;
  savedProviderId: string | null;
  /** The event is limited to one company: only a superadmin may change its provider. */
  providerLocked: boolean;
  /** The organisation checks guests for bots on the link and password forms (a superadmin has not switched it off). */
  botCheck: boolean;
  /** A superadmin is told where to add an identity provider. */
  isSuperadmin: boolean;
  disabled: boolean;
  onMethodChange: (method: AccessMethod) => void;
  onProviderChange: (providerId: string) => void;
  onPasswordChanged: (isSet: boolean) => void;
  /** A change of the password was refused because the event is archived: the page reads the event and the settings again. */
  onArchived: () => void;
}>) {
  const { addToast } = useToast();
  // Company SSO is greyed while no identity provider is turned on, also when the event has chosen it: it stays chosen, nothing is removed.
  const reason = isSuperadmin ? NO_PROVIDER_FOR_SUPERADMIN : NO_PROVIDER_FOR_ORGANISER;
  const options = METHOD_OPTIONS.map((option) =>
    option.value === "sso" && providers.length === 0 ? { ...option, disabled: true, tooltip: reason } : option,
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
    <Card title="Access method">
      <div className="settings-card-stack">
        <p className="settings-card-intro">Choose how guests open the registration form.</p>
        <Segmented
          className="access-seg"
          ariaLabel="Access method"
          options={options}
          value={method}
          disabled={disabled}
          onChange={choose}
        />
        {method === "sso" && (
          <AccessSsoProvider
            providers={providers}
            current={currentProvider}
            value={providerId}
            saved={{ method: savedMethod, providerId: savedProviderId }}
            locked={providerLocked}
            isSuperadmin={isSuperadmin}
            disabled={disabled}
            onChange={onProviderChange}
          />
        )}
        {method !== null && method !== "sso" && <Notice variant="info">{methodNotice(method, botCheck)}</Notice>}
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
