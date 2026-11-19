import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Card, HintLabel, Notice } from "@admitto/ui";
import { ApiError, fetchRegistrationReturnAddresses, fetchRegistrationSettings } from "../api/client.js";
import type { RegistrationRedirectUriDto, RegistrationSettingsDto } from "../api/types.js";
import { useConnectionState } from "../connection/ConnectionStateProvider.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { orLoginRedirect, redirectToLogin } from "../identity/loginRedirect.js";
import { SettingsFooter } from "../settings/mailTransportFormParts.js";
import { PanelLoadError } from "../settings/PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "../settings/SettingsPanelSkeleton.js";
import { assertPresent } from "../utils/assert-present.js";
import { AccessAfterFormCard, AccessFormCard } from "./AccessFormCard.js";
import { ProblemMessage } from "./AccessFormParts.js";
import { AccessSsoClaim } from "./AccessSsoClaim.js";
import { AccessSsoProvider } from "./AccessSsoProvider.js";
import { AccessWayInCard } from "./AccessWayInCard.js";
import { EventBotProtectionRow } from "./EventBotProtectionRow.js";
import { claimErrors, missingChecks, parseClaim, type AccessDraft, type Technical } from "./accessSettings.js";
import { hasStopped, stoppedWarning } from "./ownAddress.js";
import { registrationTabPath } from "./registrationTabs.js";
import { methodEdit } from "./ssoProviderChoice.js";
import { eventReturnAddress, SsoItSetup } from "./SsoItSetup.js";
import { useAccessForm } from "./useAccessForm.js";
import "./registration-access.css";

const PANEL_HINT = "How guests register for this event: whether they can, what the form asks, and how they open it.";

const NOT_USED_NOTE = "This event does not use Company SSO, so these fields are off. To use it, choose Company SSO under Access method, above.";

/** What a person who is not a superadmin reads on the cards that only a superadmin changes. */
export const SUPERADMIN_ONLY_NOTE = "Only a superadmin can change this.";

/** The cards of the tab as its placeholder draws them: the real titles, over rows that make each card about as tall as the real one. */
export const REGISTRATION_SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "method", title: "Access method", intro: 1, rows: 1, rowHeight: 40 },
  { id: "sso", title: "Company SSO", intro: 2, fields: 3, controlHeight: 38 },
  { id: "form", title: "Form", intro: 1, rows: 4, rowHeight: 64 },
  { id: "after", title: "Handling requests", intro: 1, rows: 3, rowHeight: 64 },
];

/** The first read: the settings of the event and, for a superadmin, the return
 * addresses of the company SSO. A read of the addresses that fails leaves them out, and the panel still works. */
interface Loaded {
  settings: RegistrationSettingsDto;
  /** Every return address of the company SSO that the instance lists, for the setup for IT. */
  redirectUris: RegistrationRedirectUriDto[];
  /** The read of the return addresses failed (not for want of a session): they are not known, which is not the same as none. */
  redirectUrisFailed: boolean;
}

/** The return addresses, or null when they could not be read (a lost session goes to the sign-in). */
async function readReturnAddresses(): Promise<RegistrationRedirectUriDto[] | null> {
  try {
    return (await fetchRegistrationReturnAddresses()).redirect_uris;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirectToLogin();
    return null;
  }
}

async function readAll(eventId: string, superadmin: boolean, signal: AbortSignal): Promise<Loaded> {
  const first = { settings: await fetchRegistrationSettings(eventId, signal) };
  if (!superadmin) return { ...first, redirectUris: [], redirectUrisFailed: false };
  try {
    return { ...first, redirectUris: (await fetchRegistrationReturnAddresses(signal)).redirect_uris, redirectUrisFailed: false };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    return { ...first, redirectUris: [], redirectUrisFailed: true };
  }
}

/**
 * The "Registration" tab of Event settings, for every administrator of the event: how guests open the form, what it asks, and what happens to a request after it is sent. Whether registration is on is set in the header of the Registration page. The two form cards have the
 * page's own Save; the access method (with the event password and the bot check) and Company SSO are a superadmin's, and show what is set
 * to everybody else. A different event is a fresh panel.
 */
export function EventRegistrationPanel(props: Readonly<PanelProps>) {
  return <EventRegistrationBody key={props.eventId} {...props} />;
}

interface PanelProps {
  eventId: string;
  archived: boolean;
  superadmin: boolean;
  refreshEvent?: () => Promise<unknown>;
  /** The page asks first before it is left while the form has changes, as for its other tabs. */
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  /** Changes when the address for guests of the event changed elsewhere: the settings and the return addresses are read again, and the form is left as it is. */
  addressVersion?: number;
}

function EventRegistrationBody({ eventId, archived, superadmin, refreshEvent, onDirtyChange, onSavingChange, addressVersion }: Readonly<PanelProps>) {
  const { reportApiError } = useConnectionState();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // A failure is told to the connection state when the answer is in; a 401 hands the browser to the login page, and no error flashes up first.
  const fetchAll = useMemo(
    () =>
      orLoginRedirect(async (signal: AbortSignal) => {
        try {
          return await readAll(eventId, superadmin, signal);
        } catch (err) {
          if (err instanceof ApiError) reportApiError(err.status);
          throw err;
        }
      }),
    [eventId, superadmin, reportApiError],
  );
  const panel = usePanelLoad({ fetch: fetchAll, apply: setLoaded, fallback: "Could not load the registration settings." });

  if (!panel.gate.showContent) {
    return <SettingsPanelSkeleton label="Loading registration settings" held={!panel.gate.showIndicator} slow={panel.slow} cards={REGISTRATION_SKELETON_CARDS} />;
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
      superadmin={superadmin}
      loaded={loaded}
      refreshEvent={refreshEvent}
      onDirtyChange={onDirtyChange}
      onSavingChange={onSavingChange}
      addressVersion={addressVersion}
    />
  );
}

/** What the Company SSO card says above its fields: why they are off, when they are. */
function claimNote(usesSso: boolean, readOnly: boolean): string | undefined {
  if (readOnly) return usesSso ? SUPERADMIN_ONLY_NOTE : `This event does not use Company SSO. ${SUPERADMIN_ONLY_NOTE}`;
  return usesSso ? undefined : NOT_USED_NOTE;
}

/** The card of Company SSO: the identity provider, the claim and its values. The Save of the tab saves it. While the event uses another method the fields are grey; for anybody but a superadmin they show what is set. */
function SsoClaimCard({
  usesSso,
  archived,
  saving,
  draft,
  settings,
  savedMethod,
  setup,
  onChange,
  readOnly,
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
  /** Only a superadmin changes it: for everybody else the card shows what is set. */
  readOnly: boolean;
}>) {
  const off = !usesSso || archived || saving || readOnly;
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
              showNotice={usesSso && !readOnly}
              onChange={(providerId) => onChange({ sso_provider_id: providerId })}
            />
          }
          note={claimNote(usesSso, readOnly)}
          onChange={onChange}
        />
        {setup}
      </div>
    </Card>
  );
}


function EventRegistrationCards({
  eventId,
  archived,
  superadmin,
  loaded,
  refreshEvent,
  onDirtyChange,
  onSavingChange,
  addressVersion,
}: Readonly<{
  eventId: string;
  archived: boolean;
  superadmin: boolean;
  loaded: Loaded;
  refreshEvent?: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  addressVersion?: number;
}>) {
  const form = useAccessForm({ eventId, settings: loaded.settings, refreshEvent, superadmin });
  const { server, base, draft, dirty, saving, problem } = form;
  const [returnAddresses, setReturnAddresses] = useState(loaded.redirectUris);
  const [returnAddressesFailed, setReturnAddressesFailed] = useState(loaded.redirectUrisFailed);
  const [retryingAddresses, setRetryingAddresses] = useState(false);
  // The address for guests changed and the settings could not be read again: the setup for IT would show the old one.
  const [addressStale, setAddressStale] = useState(false);
  const newestAddressRead = useRef(0);
  const missing = missingChecks(server.readiness);
  const readOnly = !superadmin;
  const off = archived || saving;
  // Also while they are being read again: the old address is not shown or copied from the moment the address changed.
  const setupUnsure = returnAddressesFailed || addressStale || retryingAddresses;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => onSavingChange?.(saving), [saving, onSavingChange]);

  // The address for guests was changed on General while this tab stayed mounted: what the setup for IT shows is read again, and what is typed stays.
  // The effect runs on the change of the version only, and calls the latest of the functions below through a ref.
  const readAgain = () => void readAddressesAgain();
  const onAddressChange = useRef(readAgain);
  onAddressChange.current = readAgain;
  const seenAddressVersion = useRef(addressVersion);
  useEffect(() => {
    if (addressVersion === seenAddressVersion.current) return;
    seenAddressVersion.current = addressVersion;
    onAddressChange.current();
  }, [addressVersion]);

  /**
   * The settings and the return addresses, read again, busy while it works. The Retry of the setup for IT does the same. Only a
   * superadmin changes the address or sees the setup, so only a superadmin gets here. Reads can overlap (the address changed again):
   * only the latest may write what it found and end the busy state.
   */
  async function readAddressesAgain() {
    const mine = ++newestAddressRead.current;
    setRetryingAddresses(true);
    const [settingsRead, addresses] = await Promise.all([form.refresh(), readReturnAddresses()]);
    if (mine !== newestAddressRead.current) return;
    if (addresses !== null) setReturnAddresses(addresses);
    setReturnAddressesFailed(addresses === null);
    setAddressStale(!settingsRead);
    setRetryingAddresses(false);
  }

  return (
    <div className="settings-sections at-fade-in">
      {server.mode !== null && missing.length > 0 && (
        <Notice variant="warning">
          Registration is on, but something it needs is missing, so guests may not be able to register.{" "}
          <Link className="access-text-link" to={registrationTabPath(eventId, "checklist")}>
            The Checklist tab says what.
          </Link>
        </Notice>
      )}
      {hasStopped(server.own_address) && <Notice variant="warning">{stoppedWarning(server.own_address)}</Notice>}
      <AccessWayInCard
        eventId={eventId}
        event={{ archived_at: archived ? "archived" : null }}
        method={draft.method}
        savedMethod={base.method}
        passwordSet={server.password_set}
        ssoAvailable={server.sso_providers.length > 0}
        // The notice says a bot check protects the form only while the organisation has it on AND this event does (the draft, so it follows the switch).
        botCheck={server.bot_protection === "required" && draft.bot_protection_enabled}
        note={readOnly ? SUPERADMIN_ONLY_NOTE : undefined}
        extra={
          <EventBotProtectionRow
            organisationOn={server.bot_protection === "required"}
            enabled={draft.bot_protection_enabled}
            usesSso={draft.method === "sso"}
            disabled={off || readOnly}
            onChange={(enabled) => form.edit({ bot_protection_enabled: enabled })}
          />
        }
        disabled={off || readOnly}
        // Pressing the method that is chosen already changes nothing: not the provider, not the claim.
        onMethodChange={(method) => {
          if (method !== draft.method) form.edit(methodEdit(method, base.sso_provider_id, server.sso_providers));
        }}
        onPasswordChanged={form.passwordChanged}
        onArchived={form.eventArchived}
      />
      <SsoClaimCard
        usesSso={draft.method === "sso"}
        archived={archived}
        saving={saving}
        readOnly={readOnly}
        draft={draft}
        settings={server}
        savedMethod={base.method}
        setup={
          readOnly ? null : (
            <SsoItSetup
              // While the addresses could not be read again, none is shown or copied: an old one would send IT to the wrong place.
              instanceUri={setupUnsure ? null : (returnAddresses.find((entry) => entry.host === "instance")?.uri ?? null)}
              eventUri={setupUnsure ? null : eventReturnAddress(returnAddresses, server.own_address?.domain ?? null)}
              claim={{ name: base.sso_claim_name === "" ? null : base.sso_claim_name, values: parseClaim(base).values }}
              readFailed={setupUnsure}
              retrying={retryingAddresses}
              onRetry={() => void readAddressesAgain()}
            />
          )
        }
        onChange={form.edit}
      />
      <AccessFormCard eventId={eventId} draft={draft} disabled={off} onChange={form.edit} />
      <AccessAfterFormCard draft={draft} disabled={off} onChange={form.edit} />
      {problem && <ProblemMessage eventId={eventId} problem={problem} superadmin={superadmin} />}
      {!archived && <SettingsFooter hasUnsavedChanges={dirty} saving={saving} onReset={form.reset} onSave={form.save} />}
    </div>
  );
}
