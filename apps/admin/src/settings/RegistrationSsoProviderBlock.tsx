import { Link } from "react-router";
import { Input, Notice, useToast } from "@admitto/ui";
import type { RegistrationRedirectUriDto, RegistrationSsoProviderDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { ssoProviderNote, ssoProviderOptions } from "./registrationAccessMethods.js";
import "./registration-ways-in.css";

const REDIRECT_HINT =
  "Enter this address once at the identity provider, as an allowed redirect (callback) address. It is the same for every event that uses the company sign-in on the address of this instance.";
const EVENT_ADDRESS_HINT =
  "Also enter this address at the identity provider. It belongs to the events that use the company sign-in on their own address, and it is the same for all of them.";
const UNVERIFIED_NOTE = " This address has not passed its check yet. Enter it now so that the sign-in works as soon as it does.";
const GATEWAY_NOTE = "If a gateway such as Cloudflare Access stands in front of Admitto, it must let /sso/callback through without a sign-in, together with /r/*.";

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
 * Every address to list at the provider: the instance's, and one for each own address of an event that uses the company sign-in
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
          There is no return address yet, because the address of this instance is not set.{" "}
          <Link to="/admin/settings?tab=general">Set the Instance URL under General.</Link>
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
 * Under the switch of the company sign-in: the identity provider guests sign in with, where that choice stands, and the return
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
