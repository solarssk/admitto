import { useId, useState } from "react";
import { Button, Card, Notice, useToast } from "@admitto/ui";
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
  return (
    <output className="access-check access-address__status">
      <span className={`overview-check__icon overview-check__icon--${line.tone}`} aria-hidden="true">
        <i className={`ti ti-${TONE_ICONS[line.tone]}`} />
      </span>
      <span className="overview-check__body">
        <strong>
          {address.domain}: {line.title}
        </strong>
        <span className="overview-check__detail">{line.detail}</span>
        {address.checked_at !== null && <span className="overview-check__detail">Last checked {formatUtcDateTime(address.checked_at)}.</span>}
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

const NAME_PLACEHOLDER = "events.example.com";

/** One value of the DNS record, or a grey example while there is none, with a button that copies it. */
function RecordCell({ label, value, placeholder, copyLabel, arrow }: Readonly<{ label: string; value: string; placeholder: string; copyLabel?: string; arrow?: boolean }>) {
  const { addToast } = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      addToast("Copied.", "success");
    } catch {
      addToast("Could not copy.", "error");
    }
  }
  return (
    <div className="access-dns__cell" data-label={label}>
      {arrow === true && (
        <span className="access-dns__arrow" aria-hidden="true">
          <i className="ti ti-arrow-right" />
        </span>
      )}
      <span className={value === "" ? "access-dns__value access-dns__value--placeholder" : "access-dns__value"} title={value === "" ? undefined : value}>{value === "" ? placeholder : value}</span>
      {copyLabel !== undefined && value !== "" && (
        <button type="button" className="access-dns__copy" aria-label={copyLabel} onClick={() => void copy()}>
          <i className="ti ti-copy" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The instructions for IT as plain text, whole in itself: a person can read them and so can an agent that has access to the DNS. */
function instructionsText(name: string, target: string): string {
  const address = name === "" ? NAME_PLACEHOLDER : name;
  return [
    "Set up an own address for the guest registration of an event in Admitto.",
    "",
    `1. DNS: create a CNAME record from ${address} to ${target}.`,
    `2. Serve HTTPS on ${address} with a valid certificate. Admitto does not issue certificates.`,
    `3. Pass the Host header on to Admitto, and keep ${address} open to guests, outside any sign-in gateway.`,
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
  const bodyId = useId();
  const { addToast } = useToast();
  const [open, setOpen] = useState(address?.status !== "ok");
  const target = instanceHost ?? "the address of this instance";
  const name = recordName(own, address, instanceHost);
  const text = instructionsText(name, target);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      addToast("Instructions copied.", "success");
    } catch {
      addToast("Could not copy.", "error");
    }
  }

  return (
    <section className="access-it" aria-label="Setup for your IT team">
      <div className="access-it__head">
        <Button
          type="button"
          variant="ghost"
          className="access-it__toggle"
          icon={<i className={`ti ti-chevron-${open ? "down" : "right"}`} aria-hidden="true" />}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          Setup for your IT team
        </Button>
        <Button type="button" variant="secondary" size="sm" icon={<i className="ti ti-copy" aria-hidden="true" />} onClick={() => void copyAll()}>
          Copy instructions for an AI agent
        </Button>
      </div>
      <div id={bodyId} className="access-it__body" hidden={!open}>
        <ol className="access-steps">
          <li>
            <span>Create a CNAME record that points the address to {target}.</span>
            <div className="access-dns">
              <div className="access-dns__row access-dns__row--head">
                <span>Type</span>
                <span>Name</span>
                <span>Target</span>
              </div>
              <div className="access-dns__row">
                <RecordCell label="Type" value="CNAME" placeholder="" />
                <RecordCell label="Name" value={name} placeholder={NAME_PLACEHOLDER} copyLabel="Copy the name" />
                <RecordCell label="Target" value={instanceHost ?? ""} placeholder="the address of this instance" copyLabel="Copy the target" arrow />
              </div>
            </div>
          </li>
          <li>Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.</li>
          <li>Pass the Host header on to Admitto, and keep the address open to guests, outside any sign-in gateway.</li>
          <li>Select Check now. Guests get links on the address once the check passes. Until then they keep the main address.</li>
        </ol>
      </div>
    </section>
  );
}

/** The field with Save address beside it (as Provider and Test connection on the other cards), Check now and Remove under it once an address is saved, and the question before the address is removed. */
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
            <div className="external-provider-and-test">
              <div className="at-control">
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
                    Save address
                  </Button>
                )}
              </ArchivedGuard>
            </div>
            {own.fieldError ? (
              <span id={hintId} className="at-hint at-hint--error" role="alert">
                {own.fieldError}
              </span>
            ) : (
              <span id={hintId} className="at-hint">
                The host name only, such as events.example.com.
              </span>
            )}
          </div>
        </div>
      </div>
      {address !== null && (
        <div className="access-address__buttons">
          <ArchivedGuard
            event={event}
            reasonId={`${id}-check`}
            disabled={(busy && !own.checking) || !own.unchanged}
            tooltip={own.unchanged ? undefined : "Save the address first. The check asks the address that is saved."}
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
        </div>
      )}
      {own.error !== null && (
        <Notice variant="error" role="alert">
          {own.error}
        </Notice>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="Remove the own address?"
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
}: Readonly<{
  eventId: string;
  event: ArchivedGuardEvent;
  address: RegistrationOwnAddressDto | null;
  instanceHost: string | null;
  disabled: boolean;
  onChanged: (state: CustomDomainDto) => void;
  onArchived: () => void;
}>) {
  const own = useOwnAddress({ eventId, saved: address, instanceHost, onChanged, onArchived });
  return (
    <Card title="Address for guests">
      <div className="settings-card-stack">
        <p className="settings-card-intro">
          Guests are sent links on the address of this instance. An event can have an address of its own instead, such as events.example.com.
          Guests get links on it only after a check finds it working.
        </p>
        {address !== null && <AddressStatus address={address} instanceHost={instanceHost} />}
        <AddressControls event={event} own={own} address={address} disabled={disabled} />
        <ItSteps own={own} address={address} instanceHost={instanceHost} />
      </div>
    </Card>
  );
}
