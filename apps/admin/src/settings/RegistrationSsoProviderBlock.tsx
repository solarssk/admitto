import { Link } from "react-router";
import { Notice } from "@admitto/ui";
import type { RegistrationRedirectUriDto, RegistrationSsoProviderDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { ItPanel } from "../registration/ItSetup.js";
import { hostOf, ReturnAddress, ssoInstructionsText } from "../registration/SsoItSetup.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import { ssoProviderNote, ssoProviderOptions } from "./registrationAccessMethods.js";
import { EVENT_ADDRESS_HINT, GATEWAY_NOTE, REDIRECT_HINT, UNVERIFIED_NOTE } from "./registrationSsoTexts.js";
import "./registration-ways-in.css";

/** The steps for IT: the return address of the instance (or why there is none), the own address of each event that has one, and the gateway. */
function ItSteps({ uris }: Readonly<{ uris: RegistrationRedirectUriDto[] }>) {
  const instance = uris.find((entry) => entry.host === "instance");
  const ofEvents = uris.filter((entry) => entry.host === "event_domain");
  return (
    <>
      <li>
        {instance ? (
          <>
            <span>{keepLastWords(REDIRECT_HINT)}</span>
            <ReturnAddress label="Return address" uri={instance.uri} />
          </>
        ) : (
          <span>
            There is no return address yet, because the Instance URL is not set.{" "}
            <Link to="/admin/settings?tab=general">Set it under General in Organisation settings.</Link>
          </span>
        )}
      </li>
      {ofEvents.map((entry) => (
        <li key={entry.uri}>
          <span>{keepLastWords(entry.verified ? EVENT_ADDRESS_HINT : `${EVENT_ADDRESS_HINT}${UNVERIFIED_NOTE}`)}</span>
          <ReturnAddress label={`Return address for ${hostOf(entry.uri)}`} uri={entry.uri} />
        </li>
      ))}
      <li>{keepLastWords(GATEWAY_NOTE)}</li>
    </>
  );
}

/**
 * Under the switch of the company SSO: the identity provider guests sign in with (a field of half the row, with the icon of the kind of
 * provider), where that choice stands, and the setup for the IT team in a panel that is shut until it is opened. `sso` is the saved
 * state of the server; `providerId` is the choice in the form.
 */
export function RegistrationSsoProviderBlock({
  sso,
  providerId,
  disabled,
  onChange,
}: Readonly<{
  sso: RegistrationSsoProviderDto;
  providerId: string | null;
  disabled: boolean;
  onChange: (providerId: string) => void;
}>) {
  const note = ssoProviderNote(sso, providerId);
  const options = ssoProviderOptions(sso);
  return (
    <div className="ways-in-sso">
      <div className="mail-transport-section">
        <div>
          <SearchableSelect
            id="external-access-sso-provider"
            label="Identity provider"
            placeholder="Choose a provider"
            searchPlaceholder="Search providers"
            emptyLabel="No identity provider is turned on"
            value={providerId ?? ""}
            options={options}
            disabled={disabled || options.length === 0}
            describedBy="external-access-sso-note"
            onChange={onChange}
          />
          {note.tone === "info" && (
            <span id="external-access-sso-note" className="at-hint">
              {note.text}
            </span>
          )}
        </div>
      </div>
      {options.length === 0 && (
        <p className="settings-card-intro">
          No identity provider is turned on. <Link to={IDENTITY_PROVIDERS_ROUTE}>Add or turn on one under Identity.</Link>
        </p>
      )}
      {note.tone === "warning" && (
        <Notice variant="warning" id="external-access-sso-note">
          {note.text}
        </Notice>
      )}
      <ItPanel text={ssoInstructionsText(sso.redirect_uris.map((entry) => entry.uri), { name: null, values: [] })}>
        <ItSteps uris={sso.redirect_uris} />
      </ItPanel>
    </div>
  );
}
