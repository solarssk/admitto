import { Link } from "react-router";
import { Input, Notice, useToast } from "@admitto/ui";
import type { RegistrationRedirectUriDto, RegistrationSsoProviderDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { ssoProviderNote, ssoProviderOptions } from "./registrationAccessMethods.js";
import { EVENT_ADDRESS_HINT, GATEWAY_NOTE, REDIRECT_HINT, UNVERIFIED_NOTE } from "./registrationSsoTexts.js";
import "./registration-ways-in.css";

/** One address to list at the provider, with a button that copies it. */
function RedirectAddress({ id, label, uri, hint }: Readonly<{ id: string; label: string; uri: string; hint: string }>) {
  const { addToast } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      addToast("Return address copied.", "success");
    } catch {
      addToast("Could not copy the return address.", "error");
    }
  }

  return (
    <Input
      id={id}
      label={label}
      value={uri}
      readOnly
      icon={<i className="ti ti-copy" />}
      iconLabel={`Copy the ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
      onIconClick={() => void copy()}
      hint={hint}
    />
  );
}

/** The host of a return address, for the label of the field. */
function hostOf(uri: string): string {
  return new URL(uri).host;
}

/**
 * Every address to list at the provider: the instance's, and one for each own address of an event that uses the company SSO
 * (D-C6), verified or not. While the instance has no address there is none to give for it.
 */
function RedirectAddresses({ uris }: Readonly<{ uris: RegistrationRedirectUriDto[] }>) {
  const instance = uris.find((entry) => entry.host === "instance");
  const ofEvents = uris.filter((entry) => entry.host === "event_domain");
  return (
    <>
      {instance ? (
        <RedirectAddress id="external-access-sso-redirect" label="Return address" uri={instance.uri} hint={REDIRECT_HINT} />
      ) : (
        <p className="settings-card-intro">
          There is no return address yet, because the Instance URL is not set.{" "}
          <Link to="/admin/settings?tab=general">Set it under General in Organisation settings.</Link>
        </p>
      )}
      {ofEvents.map((entry, index) => (
        <RedirectAddress
          key={entry.uri}
          id={`external-access-sso-redirect-${index + 1}`}
          label={`Return address for ${hostOf(entry.uri)}`}
          uri={entry.uri}
          hint={entry.verified ? EVENT_ADDRESS_HINT : `${EVENT_ADDRESS_HINT}${UNVERIFIED_NOTE}`}
        />
      ))}
      <p className="settings-card-intro">{GATEWAY_NOTE}</p>
    </>
  );
}

/**
 * Under the switch of the company SSO: the identity provider guests sign in with, where that choice stands, and the return
 * addresses to list at the provider. `sso` is the saved state of the server; `providerId` is the choice in the form.
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
      {options.length === 0 && (
        <p className="settings-card-intro">
          No identity provider is turned on. <Link to={IDENTITY_PROVIDERS_ROUTE}>Add or turn on one under Identity.</Link>
        </p>
      )}
      {note.tone === "warning" ? (
        <Notice variant="warning" id="external-access-sso-note">
          {note.text}
        </Notice>
      ) : (
        <p id="external-access-sso-note" className="settings-card-intro">
          {note.text}
        </p>
      )}
      <RedirectAddresses uris={sso.redirect_uris} />
    </div>
  );
}
