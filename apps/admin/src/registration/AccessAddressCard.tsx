import { useId, useState } from "react";
import { Button, Card, Input, Notice, useToast } from "@admitto/ui";
import type { CustomDomainDto, RegistrationOwnAddressDto } from "../api/types.js";
import { ArchivedGuard, type ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { formatUtcDateTime } from "../utils/event-dates.js";
import { addressStatusLine, type AddressTone } from "./ownAddress.js";
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

/** A read only field of the DNS record; with `copy` an icon button at its side puts the value on the clipboard. */
function RecordField({ label, value, copy }: Readonly<{ label: string; value: string; copy?: string }>) {
  const { addToast } = useToast();
  async function copyValue(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      addToast("Copied.", "success");
    } catch {
      addToast("Could not copy.", "error");
    }
  }
  return (
    <Input
      label={label}
      value={value}
      readOnly
      {...(copy === undefined ? {} : { icon: <i className="ti ti-copy" />, iconLabel: `Copy the ${label.toLowerCase()}`, onIconClick: () => void copyValue(copy) })}
    />
  );
}

/**
 * What the organisation's IT department does, in order, under a heading that opens and closes it. The check needs the name to point
 * here, so IT comes first. It opens by itself while the address is new or its check has not passed, and stays shut for a working one.
 */
function ItSteps({ address, instanceHost }: Readonly<{ address: RegistrationOwnAddressDto | null; instanceHost: string | null }>) {
  const bodyId = useId();
  const [open, setOpen] = useState(address === null || address.status !== "ok");
  const target = instanceHost ?? "the address of this instance";
  return (
    <div className="access-address__it">
      <Button
        type="button"
        variant="ghost"
        className="access-address__it-toggle"
        icon={<i className={`ti ti-chevron-${open ? "down" : "right"}`} aria-hidden="true" />}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((current) => !current)}
      >
        Setup for your IT team
      </Button>
      <div id={bodyId} hidden={!open}>
        <ol className="access-steps">
          <li>
            <span>Create a CNAME record that points the address to {target}.</span>
            <div className="access-dns">
              <RecordField label="Type" value="CNAME" />
              <RecordField label="Name" value={address?.domain ?? ""} copy={address?.domain} />
              <RecordField label="Target" value={instanceHost ?? ""} copy={instanceHost ?? undefined} />
            </div>
          </li>
          <li>Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.</li>
          <li>Pass the Host header on to Admitto, and keep the address open to guests, outside any sign-in gateway.</li>
          <li>Select Check now. Guests get links on the address once the check passes. Until then they keep the main address.</li>
        </ol>
      </div>
    </div>
  );
}

/** The field, its buttons and the question before the address is removed: a superadmin's part of the card. */
function AddressControls({
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
  const id = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const own = useOwnAddress({ eventId, saved: address, instanceHost, onChanged, onArchived });
  const busy = disabled || own.saving || own.removing || own.checking;
  return (
    <div className="access-address__controls">
      <Input
        label="Own address"
        value={own.typed}
        placeholder="events.example.com"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        error={own.fieldError}
        hint="The host name only, such as events.example.com."
        onChange={(changeEvent) => own.edit(changeEvent.target.value)}
        onBlur={own.leave}
      />
      {own.error !== null && (
        <Notice variant="error" role="alert">
          {own.error}
        </Notice>
      )}
      <div className="access-address__buttons">
        <ArchivedGuard event={event} reasonId={`${id}-save`} disabled={(busy && !own.saving) || own.unchanged || own.typed.trim() === ""}>
          {(guard) => (
            <Button type="button" variant="primary" {...guard} loading={own.saving} onClick={own.save}>
              Save address
            </Button>
          )}
        </ArchivedGuard>
        {address !== null && (
          <>
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
          </>
        )}
      </div>
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
 * The event's own address for guests (D-C6): how it stands, the field, the buttons and the steps for IT. It is on the Registration tab of
 * Event settings, which only a superadmin reaches. It is not one of the settings that Save sends: each request here is made at once.
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
  return (
    <Card title="Address for guests">
      <div className="settings-card-stack">
        <p className="settings-card-intro">
          Guests are sent links on the address of this instance. An event can have an address of its own instead, such as events.example.com.
          Guests get links on it only after a check finds it working.
        </p>
        {address !== null && <AddressStatus address={address} instanceHost={instanceHost} />}
        <AddressControls
          eventId={eventId}
          event={event}
          address={address}
          instanceHost={instanceHost}
          disabled={disabled}
          onChanged={onChanged}
          onArchived={onArchived}
        />
        <ItSteps address={address} instanceHost={instanceHost} />
      </div>
    </Card>
  );
}
