import { useId, useState } from "react";
import { Button, Card, Input, Notice } from "@admitto/ui";
import type { CustomDomainDto, EventDto, RegistrationOwnAddressDto } from "../api/types.js";
import { ArchivedGuard } from "../components/ArchivedGuard.js";
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
    <div className="access-check access-address__status" role="status">
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
    </div>
  );
}

/** What the organisation's IT department does, in order. The check needs the name to point here, so IT comes first. */
function ItSteps({ instanceHost }: Readonly<{ instanceHost: string | null }>) {
  return (
    <div className="access-address__it">
      <strong>What IT sets up</strong>
      <ol>
        <li>Create a CNAME record that points the address to {instanceHost ?? "the address of this instance"}.</li>
        <li>Serve HTTPS on the address with a valid certificate. Admitto does not issue certificates.</li>
        <li>Pass the Host header on to Admitto, and keep the address open to guests, outside any sign-in gateway.</li>
        <li>Select Check now. Guests get links on the address once the check passes. Until then they keep the main address.</li>
      </ol>
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
  event: EventDto;
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
 * The event's own address for guests (D-C6): how it stands, for every administrator of the event, and the field, the buttons and the
 * steps for IT, for a superadmin. It is not one of the settings that Save sends: each request here is made at once. An event with no
 * address shows the card to a superadmin only.
 */
export function AccessAddressCard({
  eventId,
  event,
  address,
  instanceHost,
  canEdit,
  disabled,
  onChanged,
  onArchived,
}: Readonly<{
  eventId: string;
  event: EventDto;
  address: RegistrationOwnAddressDto | null;
  instanceHost: string | null;
  canEdit: boolean;
  disabled: boolean;
  onChanged: (state: CustomDomainDto) => void;
  onArchived: () => void;
}>) {
  if (!canEdit && address === null) return null;
  return (
    <Card title="Address for guests">
      <div className="settings-card-stack">
        <p className="settings-card-intro">
          Guests are sent links on the address of this instance. An event can have an address of its own instead, such as events.example.com.
          Guests get links on it only after a check finds it working.
        </p>
        {address !== null && <AddressStatus address={address} instanceHost={instanceHost} />}
        {canEdit ? (
          <>
            <AddressControls
              key={address?.domain ?? ""}
              eventId={eventId}
              event={event}
              address={address}
              instanceHost={instanceHost}
              disabled={disabled}
              onChanged={onChanged}
              onArchived={onArchived}
            />
            <ItSteps instanceHost={instanceHost} />
          </>
        ) : (
          <p className="settings-card-intro">A superadmin changes this address.</p>
        )}
      </div>
    </Card>
  );
}
