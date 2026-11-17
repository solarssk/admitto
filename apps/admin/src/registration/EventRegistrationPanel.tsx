import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, HintLabel, Notice, useToast } from "@admitto/ui";
import {
  ApiError,
  fetchRegistrationSettings,
  fetchRegistrationReturnAddresses,
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
import { AccessSsoClaim } from "./AccessSsoClaim.js";
import { AccessSsoProvider } from "./AccessSsoProvider.js";
import { AccessWayInCard } from "./AccessWayInCard.js";
import { EventBotProtectionRow } from "./EventBotProtectionRow.js";
import { claimErrors, draftFromSettings, parseClaim, technicalPatch, type AccessDraft } from "./accessSettings.js";
import { ownAddressOf } from "./ownAddress.js";
import { methodEdit } from "./ssoProviderChoice.js";
import { eventReturnAddress, SsoItSetup } from "./SsoItSetup.js";
import "./registration-access.css";

const PANEL_HINT = "The access method of the registration form, and the address guests use. Only a superadmin can change these.";

const NOT_USED_NOTE = "This event does not use Company SSO, so these fields are off. To use it, choose Company SSO under Access method, above.";

const SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "method", title: "Access method", intro: 1, rows: 1, rowHeight: 40 },
  { id: "sso", title: "Company SSO", intro: 2, fields: 3, controlHeight: 38 },
  { id: "address", title: "Address for guests", intro: 2, fields: 1 },
];

/** The first read: the settings of the event (the address, the restriction and the identity provider come from them) and the return
 * addresses of the company SSO, which a superadmin may read. A read of the addresses that fails leaves them out, and the panel still works. */
interface Loaded {
  settings: RegistrationSettingsDto;
  /** Every return address of the company SSO that the instance lists, for the setup for IT. */
  redirectUris: RegistrationRedirectUriDto[];
  /** The read of the return addresses failed (not for want of a session): they are not known, which is not the same as none. */
  redirectUrisFailed: boolean;
}

async function readBoth(eventId: string, signal: AbortSignal): Promise<Loaded> {
  const settings = await fetchRegistrationSettings(eventId, signal);
  try {
    return { settings, redirectUris: (await fetchRegistrationReturnAddresses(signal)).redirect_uris, redirectUrisFailed: false };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    return { settings, redirectUris: [], redirectUrisFailed: true };
  }
}

/**
 * The "Registration" tab of Event settings, for a superadmin: how guests open the form of one event (the access method, the
 * event password and, for Company SSO, the identity provider and the restriction to the people of one company), and the event's own
 * address for guests. A different event is a fresh
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
      redirectUris={loaded.redirectUris}
      redirectUrisFailed={loaded.redirectUrisFailed}
      refreshEvent={refreshEvent}
      onDirtyChange={onDirtyChange}
      onSavingChange={onSavingChange}
    />
  );
}

/** The card of Company SSO: the identity provider, the claim and its values. The Save of the tab saves it. While the event uses another method the fields are grey. */
function SsoClaimCard({
  usesSso,
  archived,
  saving,
  draft,
  settings,
  savedMethod,
  setup,
  onChange,
}: Readonly<{
  /** The way in in the form is the company SSO: the restriction belongs to that way alone, and the server refuses it for another. */
  usesSso: boolean;
  archived: boolean;
  saving: boolean;
  draft: AccessDraft;
  settings: RegistrationSettingsDto;
  /** The access method and the provider as they are saved, for the notice under the provider. */
  savedMethod: AccessDraft["method"];
  /** The setup for IT, under the fields. */
  setup: ReactNode;
  onChange: (change: Partial<Technical>) => void;
}>) {
  const off = !usesSso || archived || saving;
  return (
    <Card title="Company SSO">
      <div className="settings-card-stack">
        <AccessSsoClaim
          name={draft.sso_claim_name}
          values={draft.sso_claim_values}
          errors={claimErrors(draft)}
          disabled={off}
          providerField={
            <AccessSsoProvider
              providers={settings.sso_providers}
              current={settings.sso_provider}
              value={draft.sso_provider_id}
              saved={{ method: savedMethod, providerId: settings.sso_provider_id }}
              disabled={off}
              showNotice={usesSso}
              onChange={(providerId) => onChange({ sso_provider_id: providerId })}
            />
          }
          note={usesSso ? undefined : NOT_USED_NOTE}
          onChange={onChange}
        />
        {setup}
      </div>
    </Card>
  );
}

/** What this tab edits besides the address: how guests open the form, with the identity provider and the restriction of Company SSO. */
type Technical = Pick<AccessDraft, "method" | "bot_protection_enabled" | "sso_provider_id" | "sso_claim_name" | "sso_claim_values">;

function technicalOf(draft: AccessDraft): Technical {
  return { method: draft.method, bot_protection_enabled: draft.bot_protection_enabled, sso_provider_id: draft.sso_provider_id, sso_claim_name: draft.sso_claim_name, sso_claim_values: draft.sso_claim_values };
}

function EventRegistrationCards({
  eventId,
  archived,
  initial,
  redirectUris,
  redirectUrisFailed,
  refreshEvent,
  onDirtyChange,
  onSavingChange,
}: Readonly<{
  eventId: string;
  archived: boolean;
  initial: RegistrationSettingsDto;
  redirectUris: readonly RegistrationRedirectUriDto[];
  redirectUrisFailed: boolean;
  refreshEvent?: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}>) {
  const { addToast } = useToast();
  const [settings, setSettings] = useState(initial);
  // The restriction as the first read found it, and as typed. Both are kept apart from the settings: what the address card does, and the
  // settings that are read again after it, change the address and nothing else. What is saved moves only with a save of its own (as the
  // base of the Access form does), so a setting that somebody else changed meanwhile is not taken for an edit of this person.
  const [saved, setSaved] = useState(() => technicalOf(draftFromSettings(initial)));
  const [typed, setTyped] = useState(saved);
  const [returnAddresses, setReturnAddresses] = useState(redirectUris);
  const [returnAddressesFailed, setReturnAddressesFailed] = useState(redirectUrisFailed);
  const [retryingAddresses, setRetryingAddresses] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  // The newest read of the settings: a read that was started before a newer read never replaces what is newer.
  const newestRead = useRef(0);
  const base = useMemo(() => ({ ...draftFromSettings(settings), ...saved }), [settings, saved]);
  const draft = useMemo(() => ({ ...base, ...typed }), [base, typed]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = technicalPatch(draft, base);
  const dirty = Object.keys(patch).length > 0;
  const guardEvent: ArchivedGuardEvent = { archived_at: archived ? "archived" : null };

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  // The page warns before it is left while a request of this tab is out: the save of the restriction, and the requests of the address card.
  useEffect(() => onSavingChange?.(saving || addressBusy), [saving, addressBusy, onSavingChange]);

  /** Reads the settings and the return addresses again, quietly: the link for guests, the state of the address and the callback of a new
   * address move with a change. A read that fails leaves what the cards show as it is. */
  async function refresh() {
    const mine = ++newestRead.current;
    const [latest, addresses] = await Promise.allSettled([fetchRegistrationSettings(eventId), fetchRegistrationReturnAddresses()]);
    // A save that started meanwhile, or a newer read, has made this snapshot old.
    if (mine !== newestRead.current) return;
    if (latest.status === "fulfilled") setSettings(latest.value);
    if (addresses.status === "fulfilled") {
      setReturnAddresses(addresses.value.redirect_uris);
      setReturnAddressesFailed(false);
    }
  }

  /** Somebody else changed the provider of the event: nothing was saved. The settings are read again and the form takes them, so that
   * the person sees what is saved now and decides again. A read that fails leaves the form as it is. */
  async function startAgain() {
    const mine = ++newestRead.current;
    try {
      const latest = await fetchRegistrationSettings(eventId);
      if (mine !== newestRead.current) return;
      const next = technicalOf(draftFromSettings(latest));
      setSettings(latest);
      setSaved(next);
      setTyped(next);
    } catch {
      // What the cards show stays as it is, and so does the message that sent us here.
    }
  }

  /** The Retry of the return addresses: reads them again, busy while it works, and the answer replaces the failure. */
  async function retryReturnAddresses() {
    setRetryingAddresses(true);
    try {
      setReturnAddresses((await fetchRegistrationReturnAddresses()).redirect_uris);
      setReturnAddressesFailed(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) redirectToLogin();
    } finally {
      setRetryingAddresses(false);
    }
  }

  function edit(change: Partial<Technical>) {
    setTyped((current) => ({ ...current, ...change }));
    setError(null);
  }

  /** The password was set or removed by its own request: the card says so now, and the settings are read again. */
  function passwordChanged(isSet: boolean) {
    setSettings((current) => ({ ...current, password_set: isSet }));
    void refresh();
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
      setError("Fix the restriction to one company before you save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // The provider the form was made from (the baseline of the draft), not the one a later read found and not the one picked: a read that
      // finds another provider does not change what the person saw, so a save made after somebody else changed it is refused.
      const answer = await saveRegistrationSettings(eventId, { ...patch, expected_sso_provider_id: saved.sso_provider_id });
      // A read that started before this answer is older than it.
      newestRead.current += 1;
      // The answer says what these settings are now, and nothing else is the save's to say: the address, and what was read of it, stay as they are.
      setSettings((current) => ({
        ...current,
        access_methods: answer.access_methods,
        sso_claim_name: answer.sso_claim_name,
        sso_claim_values: answer.sso_claim_values,
        sso_provider_id: answer.sso_provider_id,
        sso_provider: answer.sso_provider,
        sso_providers: answer.sso_providers,
        password_set: answer.password_set,
      }));
      const next = technicalOf(draftFromSettings(answer));
      setSaved(next);
      setTyped(next);
      addToast("Registration settings saved.", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        redirectToLogin();
        return;
      }
      if (hasApiErrorCode(err, "event_archived")) archivedMeanwhile();
      // The provider was turned off or deleted, or registration lost something it needs, since the page was read: read it again.
      else if (hasApiErrorCode(err, "sso_provider_changed")) void startAgain();
      else if (hasApiErrorCode(err, "sso_provider_not_available") || hasApiErrorCode(err, "registration_not_ready")) void refresh();
      setError(operatorApiErrorMessage(err, "Could not save the registration settings."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-sections at-fade-in">
      <AccessWayInCard
        eventId={eventId}
        event={guardEvent}
        method={draft.method}
        savedMethod={base.method}
        passwordSet={settings.password_set}
        ssoAvailable={settings.sso_providers.length > 0}
        // The notice says a bot check protects the form only while the organisation has it on AND this event does (the draft, so it follows the switch).
        botCheck={settings.bot_protection === "required" && draft.bot_protection_enabled}
        extra={
          <EventBotProtectionRow
            organisationOn={settings.bot_protection === "required"}
            enabled={draft.bot_protection_enabled}
            usesSso={draft.method === "sso"}
            disabled={archived || saving}
            onChange={(enabled) => edit({ bot_protection_enabled: enabled })}
          />
        }
        disabled={archived || saving}
        // Pressing the method that is chosen already changes nothing: not the provider, not the claim.
        onMethodChange={(method) => {
          if (method !== draft.method) edit(methodEdit(method, base.sso_provider_id, settings.sso_providers));
        }}
        onPasswordChanged={passwordChanged}
        onArchived={archivedMeanwhile}
      />
      <SsoClaimCard
        usesSso={draft.method === "sso"}
        archived={archived}
        saving={saving}
        draft={draft}
        settings={settings}
        savedMethod={base.method}
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
        onChange={edit}
      />
      <AccessAddressCard
        eventId={eventId}
        event={guardEvent}
        address={settings.own_address}
        instanceHost={settings.instance_host}
        disabled={archived || saving}
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
          saving={saving || addressBusy}
          onReset={() => {
            setTyped(saved);
            setError(null);
          }}
          onSave={() => void save()}
        />
      )}
    </div>
  );
}
