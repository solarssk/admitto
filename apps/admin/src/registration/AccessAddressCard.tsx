import { useEffect, useId, useState } from "react";
import { keepLastWords } from "../utils/keep-last-words.js";
import { ItPanel, RecordField } from "./ItSetup.js";
import { Button, Card, Notice } from "@admitto/ui";
import type { CustomDomainDto, RegistrationOwnAddressDto } from "../api/types.js";
import { ArchivedGuard, type ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { addressStatusLine, judgeAddressInput, type AddressTone } from "./ownAddress.js";
import { useOwnAddress } from "./useOwnAddress.js";
import "./registration-access.css";

const TONE_ICONS: Record<AddressTone, string> = { ok: "check", warn: "alert-triangle", neutral: "clock" };

/** How the address stands, as a row of the checklist's kind: an icon, the state, what the last check found and what to do. */
function AddressStatus({ address, instanceHost }: Readonly<{ address: RegistrationOwnAddressDto; instanceHost: string | null }>) {
  const line = addressStatusLine(address, instanceHost);
  const lastCheckedSuffix = address.checked_at === null ? "" : "Last checked " + formatUtcDateTime(address.checked_at) + ".";
  return (
    <output className="access-check access-address__status">
      <span className={`overview-check__icon overview-check__icon--${line.tone}`} aria-hidden="true">
        <i className={`ti ti-${TONE_ICONS[line.tone]}`} />
      </span>
      <span className="overview-check__body">
        <strong>
          {address.domain}: {line.title}
        </strong>
        <span className="overview-check__detail">
          {keepLastWords(lastCheckedSuffix === "" ? line.detail : `${line.detail} ${lastCheckedSuffix}`)}
        </span>
      </span>
    </output>
  );
}

type OwnAddress = ReturnType<typeof useOwnAddress>;

/** The name of the DNS record: what was typed when it is an address the server would take, else the saved one, else nothing yet. */
function recordName(own: OwnAddress, address: RegistrationOwnAddressDto | null, instanceHost: string | null): string {
  const judged = judgeAddressInput(own.typed, instanceHost);
  return judged.ok ? judged.domain : (address?.domain ?? "");
}

const INTRO =
  "Guests get links on the address of this instance. An event can have its own address instead, such as events.example.com. Guests get links on it only after a check finds it working. If it later stops working, fix it or remove it: guests are still sent links on it.";

const FIELD_HINT = "The host name only, such as events.example.com. The buttons act at once, not with Save below.";

const NAME_PLACEHOLDER = "events.example.com";

/** The instructions for IT as plain text, whole in itself: a person can read them and so can an agent that has access to the DNS. */
function instructionsText(name: string, target: string): string {
  const address = name === "" ? NAME_PLACEHOLDER : name;
  return [
    "Set up the own address of an event for guest registration in Admitto.",
    "",
    `1. DNS: create a CNAME record (a DNS entry that makes one name an alias of another) from ${address} to ${target}.`,
    `2. Serve HTTPS on ${address} with a valid certificate. Admitto does not issue certificates.`,
    `3. Make sure the web server or proxy passes the original Host header (the address the guest typed) on to Admitto. Keep ${address} open to guests, with no sign-in gateway in front of it.`,
    "",
    "Report back when the address is ready.",
  ].join("\n");
}

/**
 * What the organisation's IT department does, in a panel that opens and closes under its heading, with a button that copies it all as
 * text for a mail. The check needs the name to point here, so IT comes first. It opens by itself while the address is new or its check
 * has not passed, and stays shut for a working one.
 */
function ItSteps({ own, address, instanceHost }: Readonly<{ own: OwnAddress; address: RegistrationOwnAddressDto | null; instanceHost: string | null }>) {
  const target = instanceHost ?? "the address of this instance";
  const name = recordName(own, address, instanceHost);
  return (
    <ItPanel text={instructionsText(name, target)}>
      <li>
        <span>{keepLastWords(`Create a CNAME record (a DNS entry that makes one name an alias of another) that points the address to ${target}.`)}</span>
        <div className="access-dns">
          <RecordField label="Type" value="CNAME" placeholder="" copyLabel="Copy the type" />
          <RecordField label="Name" value={name} placeholder={NAME_PLACEHOLDER} copyLabel="Copy the name" />
          <RecordField label="Target" value={instanceHost ?? ""} placeholder="the address of this instance" copyLabel="Copy the target" />
        </div>
      </li>
      <li>{keepLastWords("Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.")}</li>
      <li>{keepLastWords("Make sure the web server or proxy passes the original Host header (the address the guest typed) on to Admitto. Keep the address open to guests, with no sign-in gateway in front of it.")}</li>
    </ItPanel>
  );
}

/** The field with Set address, and Check now and Remove once an address is set, all in one row, and the question before the address is removed. */
function AddressControls({
  event,
  own,
  address,
  disabled,
}: Readonly<{
  event: ArchivedGuardEvent;
  own: OwnAddress;
  address: RegistrationOwnAddressDto | null;
  disabled: boolean;
}>) {
  const id = useId();
  const hintId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = disabled || own.saving || own.removing || own.checking;
  return (
    <div className="access-address__controls">
      <div className="mail-transport-section">
        <div className="mail-field-row">
          <div className="at-field">
            <label className="at-label" htmlFor={`${id}-field`}>
              Own address
            </label>
            <div className="access-address__row">
              <div className="at-control access-address__field">
                <input
                  id={`${id}-field`}
                  className={`at-input${own.fieldError ? " at-input--invalid" : ""}`}
                  value={own.typed}
                  placeholder={NAME_PLACEHOLDER}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={disabled}
                  aria-invalid={own.fieldError ? true : undefined}
                  aria-describedby={hintId}
                  onChange={(changeEvent) => own.edit(changeEvent.target.value)}
                  onBlur={own.leave}
                />
              </div>
              <ArchivedGuard event={event} reasonId={`${id}-save`} disabled={(busy && !own.saving) || own.unchanged || own.typed.trim() === ""}>
                {(guard) => (
                  <Button type="button" variant="primary" {...guard} loading={own.saving} onClick={own.save}>
                    Set address
                  </Button>
                )}
              </ArchivedGuard>
              {address !== null && (
                <>
                  <ArchivedGuard
                    event={event}
                    reasonId={`${id}-check`}
                    disabled={(busy && !own.checking) || !own.unchanged}
                    tooltip={own.unchanged ? undefined : "Set the address first. The check asks the address that is set."}
                  >
                    {(guard) => (
                      <Button type="button" variant="secondary" {...guard} loading={own.checking} onClick={own.check}>
                        Check now
                      </Button>
                    )}
                  </ArchivedGuard>
                  <ArchivedGuard event={event} reasonId={`${id}-remove`} disabled={busy}>
                    {(guard) => (
                      <Button type="button" variant="ghost" {...guard} onClick={() => setConfirmOpen(true)}>
                        Remove
                      </Button>
                    )}
                  </ArchivedGuard>
                </>
              )}
            </div>
            {own.fieldError ? (
              <span id={hintId} className="at-hint at-hint--error" role="alert">
                {own.fieldError}
              </span>
            ) : (
              <span id={hintId} className="at-hint">
                {keepLastWords(FIELD_HINT)}
              </span>
            )}
          </div>
        </div>
      </div>
      {own.error !== null && (
        <Notice variant="error" role="alert">
          {own.error}
        </Notice>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="Remove the event's own address?"
        message="Guests get links on the main address again, and the address stops opening this event's pages. Links already sent keep pointing at it."
        confirmLabel="Remove address"
        errorMessage={own.error}
        loading={own.removing}
        onConfirm={() => void own.remove().then((removed) => setConfirmOpen(!removed))}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/**
 * The event's own address for guests (D-C6): how it stands, the field with its buttons and the setup for IT. It is on the Registration tab
 * of Event settings, which only a superadmin reaches. It is not one of the settings that Save sends: each request here is made at once.
 */
export function AccessAddressCard({
  eventId,
  event,
  address,
  instanceHost,
  disabled,
  onChanged,
  onArchived,
  onBusyChange,
}: Readonly<{
  eventId: string;
  event: ArchivedGuardEvent;
  address: RegistrationOwnAddressDto | null;
  instanceHost: string | null;
  disabled: boolean;
  onChanged: (state: CustomDomainDto) => void;
  onArchived: () => void;
  /** Whether a request of the card (save, check, remove) is out, for a page that warns before it is left. */
  onBusyChange?: (busy: boolean) => void;
}>) {
  const own = useOwnAddress({ eventId, saved: address, instanceHost, onChanged, onArchived });
  const busy = own.saving || own.checking || own.removing;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  return (
    <Card title="Address for guests">
      <div className="settings-card-stack">
        <p className="settings-card-intro">{keepLastWords(INTRO)}</p>
        {address !== null && <AddressStatus address={address} instanceHost={instanceHost} />}
        <AddressControls event={event} own={own} address={address} disabled={disabled} />
        <ItSteps own={own} address={address} instanceHost={instanceHost} />
      </div>
    </Card>
  );
}
