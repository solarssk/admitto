import { Link } from "react-router";
import { Notice } from "@admitto/ui";
import type { EventSsoProviderDto, RegistrationSettingsDto } from "../api/types.js";
import { SearchableSelect } from "../components/SearchableSelect.js";
import { IDENTITY_PROVIDERS_ROUTE } from "../identity/routes.js";
import { keepLastWords } from "../utils/keep-last-words.js";
import type { AccessMethod } from "./accessSettings.js";
import { ADD_PROVIDER, NO_PROVIDER, PROVIDER_HINT, providerNotice, providerOptions } from "./ssoProviderChoice.js";
import "./registration-access.css";

/**
 * The identity provider guests of this event sign in with, and how that choice stands. The picker is half of the card. Without a
 * provider to pick, it says where to add one. While the event does not use Company SSO the picker is grey and says nothing more
 * (the card says why).
 */
export function AccessSsoProvider({
  providers,
  current,
  value,
  saved,
  disabled,
  showNotice,
  onChange,
}: Readonly<{
  providers: RegistrationSettingsDto["sso_providers"];
  /** The provider the event has saved, with its state. */
  current: EventSsoProviderDto | null;
  /** The provider in the form. */
  value: string | null;
  saved: { method: AccessMethod | null; providerId: string | null };
  disabled: boolean;
  /** How the choice stands: only while the event uses Company SSO. */
  showNotice: boolean;
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
          emptyLabel={NO_PROVIDER}
          value={value ?? ""}
          options={options}
          disabled={disabled || options.length === 0}
          describedBy="access-sso-provider-note"
          hint={keepLastWords(PROVIDER_HINT)}
          onChange={onChange}
        />
      </div>
      {options.length === 0 && (
        <p className="settings-card-intro">
          {NO_PROVIDER} <Link to={IDENTITY_PROVIDERS_ROUTE}>{ADD_PROVIDER}</Link>
        </p>
      )}
      {showNotice && (
        <Notice variant={notice.variant} id="access-sso-provider-note">
          {keepLastWords(notice.text)}
        </Notice>
      )}
    </div>
  );
}
