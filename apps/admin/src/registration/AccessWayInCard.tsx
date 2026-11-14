import { useId, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Notice, useToast } from "@admitto/ui";
import { ApiError, clearRegistrationPassword } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { EventDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { Segmented, type SegmentedOption } from "../components/Segmented.js";
import { redirectToLogin } from "../identity/loginRedirect.js";
import type { AccessDraft, AccessMethod, ClaimErrors } from "./accessSettings.js";
import { AccessSsoClaim } from "./AccessSsoClaim.js";
import { EventPasswordDialog } from "./EventPasswordDialog.js";
import "./registration-access.css";

const METHOD_OPTIONS: ReadonlyArray<SegmentedOption<AccessMethod>> = [
  { value: "link", label: "Link" },
  { value: "password", label: "Password" },
  { value: "sso", label: "Company sign-in" },
];

const METHOD_HINTS: Readonly<Record<AccessMethod, string>> = {
  link: "Anyone who has the link can ask to join. A bot check protects the form.",
  password: "Guests must type the event password to open the form. A bot check protects it too.",
  sso: "Guests sign in with the company's identity provider to open the form. The email address comes from that sign-in and cannot be changed on the form.",
};

/** What the person reads under the choice for a way in that a superadmin has not turned on for the organisation: the superadmin gets the place to do it. */
function NotAllowedReasons({
  methods,
  isSuperadmin,
  id,
}: Readonly<{ methods: readonly SegmentedOption<AccessMethod>[]; isSuperadmin: boolean; id: string }>) {
  if (methods.length === 0) return null;
  return (
    <ul id={id} className="access-not-allowed">
      {methods.map((method) => (
        <li key={method.value} className="at-hint">
          <strong>{method.label}:</strong> Not turned on for this organisation.{" "}
          {isSuperadmin ? <Link to="/admin/settings?tab=external">Turn it on in Organisation settings</Link> : "Ask a superadmin."}
        </li>
      ))}
    </ul>
  );
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
  claim,
  claimErrors,
  passwordSet,
  enabledMethods,
  isSuperadmin,
  disabled,
  onMethodChange,
  onClaimChange,
  onPasswordChanged,
  onArchived,
}: Readonly<{
  eventId: string;
  event: EventDto;
  /** The way in the form holds now, and the one that is saved. */
  method: AccessMethod | null;
  savedMethod: AccessMethod | null;
  /** The restriction of the company sign-in as typed, and what is wrong with it. */
  claim: Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">;
  claimErrors: ClaimErrors;
  passwordSet: boolean;
  /** The ways in a superadmin has turned on for the organisation. The others cannot be chosen. */
  enabledMethods: readonly AccessMethod[];
  /** A superadmin is told where to turn a way in on, and is the only one who changes the restriction of the company sign-in. */
  isSuperadmin: boolean;
  disabled: boolean;
  onMethodChange: (method: AccessMethod) => void;
  onClaimChange: (change: Partial<Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">>) => void;
  onPasswordChanged: (isSet: boolean) => void;
  /** A change of the password was refused because the event is archived: the page reads the event and the settings again. */
  onArchived: () => void;
}>) {
  const { addToast } = useToast();
  const reasonsId = useId();
  // A way in that is not turned on is greyed, also the one the event has chosen: it stays chosen, nothing is removed.
  const options = METHOD_OPTIONS.map((option) => ({ ...option, disabled: !enabledMethods.includes(option.value) }));
  const notAllowed = options.filter((option) => option.disabled);
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
          options={options}
          value={method}
          disabled={disabled}
          describedBy={notAllowed.length > 0 ? reasonsId : undefined}
          onChange={onMethodChange}
        />
        <NotAllowedReasons methods={notAllowed} isSuperadmin={isSuperadmin} id={reasonsId} />
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
        {method === "sso" && (
          <AccessSsoClaim
            name={claim.sso_claim_name}
            values={claim.sso_claim_values}
            errors={claimErrors}
            disabled={disabled}
            canEdit={isSuperadmin}
            onChange={onClaimChange}
          />
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
