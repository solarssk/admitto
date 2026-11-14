import { useEffect, useMemo, useState } from "react";
import { Button, Card, HintLabel, Input, Notice, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchRegistrationSettings,
  fetchRegistrationSsoProvider,
  saveRegistrationSettings,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CustomDomainDto, RegistrationSettingsDto } from "../api/types.js";
import { ArchivedGuard, type ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect, redirectToLogin } from "../identity/loginRedirect.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { AccessAddressCard } from "./AccessAddressCard.js";
import { AccessSsoClaim } from "./AccessSsoClaim.js";
import { claimErrors, draftFromSettings, settingsPatch, type AccessDraft } from "./accessSettings.js";
import { ownAddressOf } from "./ownAddress.js";
import "./registration-access.css";

const PANEL_HINT = "The parts of guest registration that a superadmin sets for this event.";
const PROVIDER_HINT = "Chosen for the organisation, in Organisation settings, Identity.";

const SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "sso", title: "Company SSO", intro: 2, fields: 3, controlHeight: 38 },
  { id: "address", title: "Address for guests", intro: 2, fields: 1 },
];

/** The first read: the settings of the event (the address and the restriction come from them) and the name of the identity provider, which a
 * superadmin may read. The name is a nicety: a read of it that fails leaves the row out, and the panel still works. */
async function readBoth(eventId: string, signal: AbortSignal): Promise<{ settings: RegistrationSettingsDto; providerName: string | null }> {
  const settings = await fetchRegistrationSettings(eventId, signal);
  let provider: Awaited<ReturnType<typeof fetchRegistrationSsoProvider>> | null = null;
  try {
    provider = await fetchRegistrationSsoProvider(signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
  }
  const chosen = provider?.providers.find((candidate) => candidate.id === provider?.provider_id);
  return { settings, providerName: chosen?.display_name ?? null };
}

/**
 * The "Registration" tab of Event settings, for a superadmin: what only a superadmin sets about guest registration of one event, the
 * restriction of the company SSO to the people of one company, and the event's own address for guests. A different event is a fresh
 * panel. The cards save themselves, as they did on the Access tab of the Registration page.
 */
export function EventRegistrationPanel({
  eventId,
  archived,
  refreshEvent,
}: Readonly<{ eventId: string; archived: boolean; refreshEvent?: () => Promise<unknown> }>) {
  return <EventRegistrationBody key={eventId} eventId={eventId} archived={archived} refreshEvent={refreshEvent} />;
}

function EventRegistrationBody({
  eventId,
  archived,
  refreshEvent,
}: Readonly<{ eventId: string; archived: boolean; refreshEvent?: () => Promise<unknown> }>) {
  const { reportApiError } = useConnectionState();
  const [loaded, setLoaded] = useState<{ settings: RegistrationSettingsDto; providerName: string | null } | null>(null);
  const fetchAll = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await readBoth(eventId, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, reportApiError],
  );
  const panel = usePanelLoad({ fetch: fetchAll, apply: setLoaded, fallback: "Could not load the registration settings." });

  if (!panel.gate.showContent) {
    return <SettingsPanelSkeleton label="Loading registration settings" held={!panel.gate.showIndicator} slow={panel.slow} cards={SKELETON_CARDS} footer={false} />;
  }
  if (panel.error !== null) {
    return (
      <PanelLoadError
        cardTitle={<HintLabel hint={PANEL_HINT}>Registration</HintLabel>}
        title="Could not load the registration settings"
        message={panel.error}
        retrying={panel.retrying}
        onRetry={panel.retry}
      />
    );
  }
  assertPresent(loaded);
  return <EventRegistrationCards eventId={eventId} archived={archived} initial={loaded.settings} providerName={loaded.providerName} refreshEvent={refreshEvent} />;
}

/** The card of the restriction: the provider (read only), the claim and its values, and the Save of the card. */
function SsoClaimCard({
  eventId,
  usesSso,
  archived,
  providerName,
  base,
  onSaved,
  onArchived,
}: Readonly<{
  eventId: string;
  /** The event's way in is the company SSO: the restriction belongs to that way alone, and the server refuses it for another. */
  usesSso: boolean;
  archived: boolean;
  providerName: string | null;
  base: AccessDraft;
  onSaved: (answer: RegistrationSettingsDto) => void;
  onArchived: () => void;
}>) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = claimErrors(draft);
  const patch = settingsPatch(draft, base);
  const dirty = Object.keys(patch).length > 0;

  // What the server holds after a save is the new starting point.
  useEffect(() => setDraft(base), [base]);

  async function save() {
    // The button is busy while a save runs, and off while nothing changed or something is wrong.
    /* v8 ignore if */
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const answer = await saveRegistrationSettings(eventId, patch);
      addToast("Registration settings saved.", "success");
      onSaved(answer);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      if (hasApiErrorCode(err, "event_archived")) onArchived();
      setError(operatorApiErrorMessage(err, "Could not save the registration settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Company SSO">
      <div className="settings-card-stack">
        {providerName !== null && <Input label="Identity provider" value={providerName} readOnly hint={PROVIDER_HINT} />}
        {usesSso ? (
          <AccessSsoClaim
            name={draft.sso_claim_name}
            values={draft.sso_claim_values}
            errors={errors}
            disabled={archived || saving}
            onChange={(change) => {
              setDraft((current) => ({ ...current, ...change }));
              setError(null);
            }}
          />
        ) : (
          <p className="settings-card-intro">This event does not use the company SSO. Choose it as the way guests open the form, on the Access tab of Registration.</p>
        )}
        {error !== null && (
          <Notice variant="error" role="alert">
            {error}
          </Notice>
        )}
        {usesSso && (
          <div className="access-address__buttons">
            <ArchivedGuard event={{ archived_at: archived ? "archived" : null }} reasonId={`sso-claim-${eventId}`} disabled={!dirty || Object.keys(errors).length > 0}>
              {(guard) => (
                <Button type="button" variant="primary" {...guard} loading={saving} onClick={() => void save()}>
                  Save
                </Button>
              )}
            </ArchivedGuard>
          </div>
        )}
      </div>
    </Card>
  );
}

function EventRegistrationCards({
  eventId,
  archived,
  initial,
  providerName,
  refreshEvent,
}: Readonly<{
  eventId: string;
  archived: boolean;
  initial: RegistrationSettingsDto;
  providerName: string | null;
  refreshEvent?: () => Promise<unknown>;
}>) {
  const [settings, setSettings] = useState(initial);
  const base = useMemo(() => draftFromSettings(settings), [settings]);
  const guardEvent: ArchivedGuardEvent = { archived_at: archived ? "archived" : null };

  /** Reads the settings again, quietly: the link for guests and the state of the address move with a change. */
  async function refresh() {
    try {
      setSettings(await fetchRegistrationSettings(eventId));
    } catch {
      // What the cards show stays as it is.
    }
  }

  function archivedMeanwhile() {
    void refreshEvent?.();
    void refresh();
  }

  function addressChanged(state: CustomDomainDto) {
    setSettings((current) => ({ ...current, own_address: ownAddressOf(state) }));
    void refresh();
  }

  return (
    <div className="settings-sections at-fade-in">
      <SsoClaimCard
        eventId={eventId}
        usesSso={base.method === "sso"}
        archived={archived}
        providerName={providerName}
        base={base}
        onSaved={setSettings}
        onArchived={archivedMeanwhile}
      />
      <AccessAddressCard
        eventId={eventId}
        event={guardEvent}
        address={settings.own_address}
        instanceHost={settings.instance_host}
        disabled={archived}
        onChanged={addressChanged}
        onArchived={archivedMeanwhile}
      />
    </div>
  );
}
