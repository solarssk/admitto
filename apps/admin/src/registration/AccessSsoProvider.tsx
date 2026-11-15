import { Link } from "react-router";
import { Notice } from "@admitto/ui";
import type { EventSsoProviderDto, RegistrationSettingsDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import type { AccessMethod } from "./accessSettings.js";
import { LOCKED_NOTE, NO_PROVIDER_FOR_ORGANISER, PROVIDER_HINT, providerNotice, providerOptions } from "./ssoProviderChoice.js";
import "./registration-access.css";

/** What the picker says while there is nothing to pick: a superadmin gets the way to Identity, anybody else is told to ask. */
function EmptyList({ isSuperadmin }: Readonly<{ isSuperadmin: boolean }>) {
  return (
    <p className="settings-card-intro">
      {isSuperadmin ? (
        <>
          No identity provider is turned on. <Link to={IDENTITY_PROVIDERS_ROUTE}>Add one under Identity.</Link>
        </>
      ) : (
        NO_PROVIDER_FOR_ORGANISER
      )}
    </p>
  );
}

/**
 * Under the choice of Company SSO: the identity provider guests of this event sign in with, and how that choice stands. The picker
 * is half of the card. While the event is limited to one company, only a superadmin may change the provider: anybody else reads it.
 */
export function AccessSsoProvider({
  providers,
  current,
  value,
  saved,
  locked,
  isSuperadmin,
  disabled,
  onChange,
}: Readonly<{
  providers: RegistrationSettingsDto["sso_providers"];
  /** The provider the event has saved, with its state. */
  current: EventSsoProviderDto | null;
  /** The provider in the form. */
  value: string | null;
  saved: { method: AccessMethod | null; providerId: string | null };
  locked: boolean;
  isSuperadmin: boolean;
  disabled: boolean;
  onChange: (providerId: string) => void;
}>) {
  const options = providerOptions(providers, current, value);
  const notice = providerNotice({ providers, current, chosenId: value, saved });
  return (
    <div className="access-provider">
      <div className="access-provider__field">
        <SearchableSelect
          id="access-sso-provider"
          label="Identity provider"
          placeholder="Choose a provider"
          searchPlaceholder="Search providers"
          emptyLabel="No identity provider is turned on"
          value={value ?? ""}
          options={options}
          disabled={disabled || locked || options.length === 0}
          describedBy="access-sso-provider-note"
          hint={keepLastWords(PROVIDER_HINT)}
          onChange={onChange}
        />
      </div>
      {options.length === 0 && <EmptyList isSuperadmin={isSuperadmin} />}
      {locked && <p className="settings-card-intro">{keepLastWords(LOCKED_NOTE)}</p>}
      <Notice variant={notice.variant} id="access-sso-provider-note">
        {keepLastWords(notice.text)}
      </Notice>
    </div>
  );
}
