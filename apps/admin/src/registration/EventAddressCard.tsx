import { useMemo, useState } from "react";
import { HintLabel } from "@admitto/ui";
import { ApiError, fetchRegistrationSettings } from "../api/client.js";
import type { CustomDomainDto, RegistrationSettingsDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect } from "../identity/loginRedirect.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { AccessAddressCard } from "./AccessAddressCard.js";
import { ownAddressOf } from "./ownAddress.js";

const CARD_HINT = "The address guests get links on: tickets, QR codes, emails and registration.";

/** The card as its placeholder draws it: the real title, over the rows that make it about as tall as the real one. */
export const ADDRESS_SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [{ id: "address", title: "Address for guests", intro: 2, fields: 1 }];

/**
 * The card "Address for guests" of Event settings, General: the event's own address and how it stands. It reads the registration settings
 * of the event (where the address is kept) on its own, so that the General tab does not wait for it. A superadmin sets, checks and removes
 * the address; every other administrator sees how it stands. A different event is a fresh card.
 */
export function EventAddressCard(props: Readonly<AddressCardProps>) {
  return <EventAddressBody key={props.eventId} {...props} />;
}

interface AddressCardProps {
  eventId: string;
  archived: boolean;
  superadmin: boolean;
  refreshEvent?: () => Promise<unknown>;
  /** The address changed: other tabs that show it read it again. */
  onChanged?: () => void;
  /** Whether a request of the card is out, for the page that warns before it is left. */
  onBusyChange?: (busy: boolean) => void;
}

function EventAddressBody({ eventId, archived, superadmin, refreshEvent, onChanged, onBusyChange }: Readonly<AddressCardProps>) {
  const { reportApiError } = useConnectionState();
  const [settings, setSettings] = useState<RegistrationSettingsDto | null>(null);
  // A failure is told to the connection state when the answer is in; a 401 hands the browser to the login page, and no error flashes up first.
  const read = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await fetchRegistrationSettings(eventId, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const panel = usePanelLoad({ fetch: read, apply: setSettings, fallback: "Could not load the address for guests." });

  if (!panel.gate.showContent) {
    return <SettingsPanelSkeleton label="Loading the address for guests" held={!panel.gate.showIndicator} slow={panel.slow} cards={ADDRESS_SKELETON_CARDS} footer={false} />;
  }
  if (panel.error !== null) {
    return (
      <PanelLoadError
        cardTitle={<HintLabel hint={CARD_HINT}>Address for guests</HintLabel>}
        title="Could not load the address for guests"
        message={panel.error}
        retrying={panel.retrying}
        onRetry={panel.retry}
      />
    );
  }
  assertPresent(settings);
  return (
    <AccessAddressCard
      superadmin={superadmin}
      eventId={eventId}
      event={{ archived_at: archived ? "archived" : null }}
      address={settings.own_address}
      instanceHost={settings.instance_host}
      disabled={archived}
      onChanged={(state: CustomDomainDto) => {
        setSettings((current) => (current === null ? current : { ...current, own_address: ownAddressOf(state) }));
        onChanged?.();
      }}
      onArchived={() => void refreshEvent?.()}
      onBusyChange={onBusyChange}
    />
  );
}
