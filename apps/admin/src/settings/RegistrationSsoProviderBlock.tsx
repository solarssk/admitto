import { Link } from "react-router";
import { Input, Notice, useToast } from "@admitto/ui";
import type { RegistrationSsoProviderDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { ssoProviderNote, ssoProviderOptions } from "./registrationAccessMethods.js";
import "./registration-ways-in.css";

const REDIRECT_HINT =
  "Enter this address once at the identity provider, as an allowed redirect (callback) address. It is the same for every event that uses the company sign-in.";
const GATEWAY_NOTE = "If a gateway such as Cloudflare Access stands in front of Admitto, it must let /sso/callback through without a sign-in, together with /r/*.";

/** The address to list at the provider, with a button that copies it; while the instance has no address there is none to give. */
function RedirectAddress({ uri }: Readonly<{ uri: string | null }>) {
  const { addToast } = useToast();
  if (uri === null) {
    return (
      <p className="settings-card-intro">
        There is no return address yet, because the address of this instance is not set.{" "}
        <Link to="/admin/settings?tab=general">Set the Instance URL under General.</Link>
      </p>
    );
  }
  const address = uri;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      addToast("Return address copied.", "success");
    } catch {
      addToast("Could not copy the return address.", "error");
    }
  }

  return (
    <>
      <Input
        id="external-access-sso-redirect"
        label="Return address"
        value={address}
        readOnly
        icon={<i className="ti ti-copy" />}
        iconLabel="Copy the return address"
        onIconClick={() => void copy()}
        hint={REDIRECT_HINT}
      />
      <p className="settings-card-intro">{GATEWAY_NOTE}</p>
    </>
  );
}

/**
 * Under the switch of the company sign-in: the identity provider guests sign in with, where that choice stands, and the one return
 * address to list at the provider. `sso` is the saved state of the server; `providerId` is the choice in the form.
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
      <RedirectAddress uri={sso.redirect_uri} />
    </div>
  );
}
