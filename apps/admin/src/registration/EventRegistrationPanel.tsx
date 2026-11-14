import { useEffect, useMemo, useState } from "react";
import { Card, HintLabel, Notice, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchRegistrationSettings,
  fetchRegistrationSsoProvider,
  saveRegistrationSettings,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CustomDomainDto, RegistrationSettingsDto } from "../api/types.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect, redirectToLogin } from "../identity/loginRedirect.js";
import { SettingsFooter } from "../settings/mailTransportFormParts.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { AccessAddressCard } from "./AccessAddressCard.js";
import { AccessSsoClaim } from "./AccessSsoClaim.js";
import { claimErrors, draftFromSettings, settingsPatch, type AccessDraft } from "./accessSettings.js";
import { ownAddressOf } from "./ownAddress.js";
import "./registration-access.css";

const PANEL_HINT = "The parts of guest registration that a superadmin sets for this event.";

const NOT_USED_NOTE = "Company SSO is not chosen for this event. Choose it as the way guests open the form, on the Access tab of Registration.";

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
export function EventRegistrationPanel(props: Readonly<PanelProps>) {
  return <EventRegistrationBody key={props.eventId} {...props} />;
}

interface PanelProps {
  eventId: string;
  archived: boolean;
  refreshEvent?: () => Promise<unknown>;
  /** The page asks first before it is left while the restriction has changes, as for its other tabs. */
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

function EventRegistrationBody({ eventId, archived, refreshEvent, onDirtyChange, onSavingChange }: Readonly<PanelProps>) {
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
    return <SettingsPanelSkeleton label="Loading registration settings" held={!panel.gate.showIndicator} slow={panel.slow} cards={SKELETON_CARDS} />;
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
  return (
    <EventRegistrationCards
      eventId={eventId}
      archived={archived}
      initial={loaded.settings}
      providerName={loaded.providerName}
      refreshEvent={refreshEvent}
      onDirtyChange={onDirtyChange}
      onSavingChange={onSavingChange}
    />
  );
}

/** The card of the restriction: the provider (read only), the claim and its values. The Save of the tab saves it. */
function SsoClaimCard({
  usesSso,
  archived,
  saving,
  providerName,
  draft,
  onChange,
}: Readonly<{
  /** The event's way in is the company SSO: the restriction belongs to that way alone, and the server refuses it for another. */
  usesSso: boolean;
  archived: boolean;
  saving: boolean;
  providerName: string | null;
  draft: AccessDraft;
  onChange: (change: Partial<Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">>) => void;
}>) {
  return (
    <Card title="Company SSO">
      <div className="settings-card-stack">
        <AccessSsoClaim
          name={draft.sso_claim_name}
          values={draft.sso_claim_values}
          errors={claimErrors(draft)}
          disabled={!usesSso || archived || saving}
          providerName={providerName}
          note={usesSso ? undefined : NOT_USED_NOTE}
          onChange={onChange}
        />
      </div>
    </Card>
  );
}

type Claim = Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">;

function claimOf(draft: AccessDraft): Claim {
  return { sso_claim_name: draft.sso_claim_name, sso_claim_values: draft.sso_claim_values };
}

function EventRegistrationCards({
  eventId,
  archived,
  initial,
  providerName,
  refreshEvent,
  onDirtyChange,
  onSavingChange,
}: Readonly<{
  eventId: string;
  archived: boolean;
  initial: RegistrationSettingsDto;
  providerName: string | null;
  refreshEvent?: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}>) {
  const { addToast } = useToast();
  const [settings, setSettings] = useState(initial);
  const base = useMemo(() => draftFromSettings(settings), [settings]);
  // What is typed in the restriction. It is kept apart from the settings: what the address card does, and the settings that are read
  // again after it, must never take the typed text away. It starts over only with Reset and with a save of its own.
  const [typed, setTyped] = useState(() => claimOf(base));
  const draft = useMemo(() => ({ ...base, ...typed }), [base, typed]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = settingsPatch(draft, base);
  const dirty = Object.keys(patch).length > 0;
  const guardEvent: ArchivedGuardEvent = { archived_at: archived ? "archived" : null };

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => onSavingChange?.(saving), [saving, onSavingChange]);

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

  async function save() {
    // The Save button is off while nothing changed and busy while a save runs.
    /* v8 ignore if */
    if (saving || !dirty) return;
    if (Object.keys(claimErrors(draft)).length > 0) {
      setError("Fix the restriction of the company SSO before you save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const answer = await saveRegistrationSettings(eventId, patch);
      setSettings(answer);
      setTyped(claimOf(draftFromSettings(answer)));
      addToast("Registration settings saved.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      if (hasApiErrorCode(err, "event_archived")) archivedMeanwhile();
      setError(operatorApiErrorMessage(err, "Could not save the registration settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-sections at-fade-in">
      <SsoClaimCard
        usesSso={base.method === "sso"}
        archived={archived}
        saving={saving}
        providerName={providerName}
        draft={draft}
        onChange={(change) => {
          setTyped((current) => ({ ...current, ...change }));
          setError(null);
        }}
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
      {error !== null && (
        <Notice variant="error" role="alert">
          {error}
        </Notice>
      )}
      {!archived && (
        <SettingsFooter
          hasUnsavedChanges={dirty}
          saving={saving}
          onReset={() => {
            setTyped(claimOf(base));
            setError(null);
          }}
          onSave={() => void save()}
        />
      )}
    </div>
  );
}
