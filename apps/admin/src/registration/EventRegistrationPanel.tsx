import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, HintLabel, Notice, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchRegistrationSettings,
  fetchRegistrationSsoProvider,
  saveRegistrationSettings,
} from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { CustomDomainDto, RegistrationRedirectUriDto, RegistrationSettingsDto } from "../api/types.js";
import type { ArchivedGuardEvent } from "../components/ArchivedGuard.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect, redirectToLogin } from "../identity/loginRedirect.js";
import { SettingsFooter } from "../settings/mailTransportFormParts.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { AccessAddressCard } from "./AccessAddressCard.js";
import { AccessSsoClaim, type SsoProviderSummary } from "./AccessSsoClaim.js";
import { claimErrors, draftFromSettings, parseClaim, settingsPatch, type AccessDraft } from "./accessSettings.js";
import { ownAddressOf } from "./ownAddress.js";
import { eventReturnAddress, SsoItSetup } from "./SsoItSetup.js";
import "./registration-access.css";

const PANEL_HINT = "The parts of guest registration that a superadmin sets for this event.";

const NOT_USED_NOTE = "Company SSO is not chosen for this event. Choose it as the way guests open the form, on the Access tab of Registration.";

const SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "sso", title: "Company SSO", intro: 2, fields: 3, controlHeight: 38 },
  { id: "address", title: "Address for guests", intro: 2, fields: 1 },
];

/** The first read: the settings of the event (the address and the restriction come from them) and the name of the identity provider, which a
 * superadmin may read. The name is a nicety: a read of it that fails leaves the row out, and the panel still works. */
interface Loaded {
  settings: RegistrationSettingsDto;
  provider: SsoProviderSummary | null;
  /** Every return address of the company SSO that the instance lists, for the setup for IT. */
  redirectUris: RegistrationRedirectUriDto[];
  /** The read of the identity provider failed (not for want of a session): the return addresses are not known, which is not the same as none. */
  redirectUrisFailed: boolean;
}

async function readBoth(eventId: string, signal: AbortSignal): Promise<Loaded> {
  const settings = await fetchRegistrationSettings(eventId, signal);
  let provider: Awaited<ReturnType<typeof fetchRegistrationSsoProvider>> | null = null;
  let redirectUrisFailed = false;
  try {
    provider = await fetchRegistrationSsoProvider(signal);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    redirectUrisFailed = true;
  }
  const chosen = provider?.providers.find((candidate) => candidate.id === provider?.provider_id);
  return { settings, provider: chosen === undefined ? null : { name: chosen.display_name, kind: chosen.kind }, redirectUris: provider?.redirect_uris ?? [], redirectUrisFailed };
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
  const [loaded, setLoaded] = useState<Loaded | null>(null);
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
      provider={loaded.provider}
      redirectUris={loaded.redirectUris}
      redirectUrisFailed={loaded.redirectUrisFailed}
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
  provider,
  draft,
  setup,
  onChange,
}: Readonly<{
  /** The event's way in is the company SSO: the restriction belongs to that way alone, and the server refuses it for another. */
  usesSso: boolean;
  archived: boolean;
  saving: boolean;
  provider: SsoProviderSummary | null;
  draft: AccessDraft;
  /** The setup for IT, under the fields. */
  setup: ReactNode;
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
          provider={provider}
          note={usesSso ? undefined : NOT_USED_NOTE}
          onChange={onChange}
        />
        {setup}
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
  provider,
  redirectUris,
  redirectUrisFailed,
  refreshEvent,
  onDirtyChange,
  onSavingChange,
}: Readonly<{
  eventId: string;
  archived: boolean;
  initial: RegistrationSettingsDto;
  provider: SsoProviderSummary | null;
  redirectUris: readonly RegistrationRedirectUriDto[];
  redirectUrisFailed: boolean;
  refreshEvent?: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}>) {
  const { addToast } = useToast();
  const [settings, setSettings] = useState(initial);
  // The restriction as the first read found it, and as typed. Both are kept apart from the settings: what the address card does, and the
  // settings that are read again after it, change the address and nothing else. The saved restriction moves only with a save of its own
  // (as the base of the Access form does), so a restriction that somebody else changed meanwhile is not taken for an edit of this person.
  const [savedClaim, setSavedClaim] = useState(() => claimOf(draftFromSettings(initial)));
  const [typed, setTyped] = useState(savedClaim);
  const [returnAddresses, setReturnAddresses] = useState(redirectUris);
  const [returnAddressesFailed, setReturnAddressesFailed] = useState(redirectUrisFailed);
  const [retryingAddresses, setRetryingAddresses] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  // The newest read of the settings: a read that was started before a save, or before a newer read, never replaces what is newer.
  const newestRead = useRef(0);
  const base = useMemo(() => ({ ...draftFromSettings(settings), ...savedClaim }), [settings, savedClaim]);
  const draft = useMemo(() => ({ ...base, ...typed }), [base, typed]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = settingsPatch(draft, base);
  const dirty = Object.keys(patch).length > 0;
  const guardEvent: ArchivedGuardEvent = { archived_at: archived ? "archived" : null };

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  // The page warns before it is left while a request of this tab is out: the save of the restriction, and the requests of the address card.
  useEffect(() => onSavingChange?.(saving || addressBusy), [saving, addressBusy, onSavingChange]);

  /** Reads the settings and the return addresses again, quietly: the link for guests, the state of the address and the callback of a new
   * address move with a change. A read that fails leaves what the cards show as it is. */
  async function refresh() {
    const mine = ++newestRead.current;
    const [latest, provider] = await Promise.allSettled([fetchRegistrationSettings(eventId), fetchRegistrationSsoProvider()]);
    // A save that started meanwhile, or a newer read, has made this snapshot old.
    if (mine !== newestRead.current) return;
    if (latest.status === "fulfilled") setSettings(latest.value);
    if (provider.status === "fulfilled") {
      setReturnAddresses(provider.value.redirect_uris);
      setReturnAddressesFailed(false);
    }
  }

  /** The Retry of the return addresses: reads them again, busy while it works, and the answer replaces the failure. */
  async function retryReturnAddresses() {
    setRetryingAddresses(true);
    try {
      setReturnAddresses((await fetchRegistrationSsoProvider()).redirect_uris);
      setReturnAddressesFailed(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) redirectToLogin();
    } finally {
      setRetryingAddresses(false);
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
    // A read that is out now would come back with the restriction as it was: it is made old by this save.
    newestRead.current += 1;
    try {
      const answer = await saveRegistrationSettings(eventId, patch);
      newestRead.current += 1;
      setSettings(answer);
      setSavedClaim(claimOf(draftFromSettings(answer)));
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
        provider={provider}
        draft={draft}
        setup={
          <SsoItSetup
            instanceUri={returnAddresses.find((entry) => entry.host === "instance")?.uri ?? null}
            eventUri={eventReturnAddress(returnAddresses, settings.own_address?.domain ?? null)}
            claim={{ name: base.sso_claim_name === "" ? null : base.sso_claim_name, values: parseClaim(base).values }}
            readFailed={returnAddressesFailed}
            retrying={retryingAddresses}
            onRetry={() => void retryReturnAddresses()}
          />
        }
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
        onBusyChange={setAddressBusy}
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
            setTyped(savedClaim);
            setError(null);
          }}
          onSave={() => void save()}
        />
      )}
    </div>
  );
}
