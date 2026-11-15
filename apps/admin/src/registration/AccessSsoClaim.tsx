import { useId } from "react";
import { SSO_CLAIM_NAME_MAX, SSO_CLAIM_VALUE_MAX, SSO_CLAIM_VALUES_MAX } from "@admitto/shared";
import { Input, Notice } from "@admitto/ui";
import { keepLastWords } from "../utils/keep-last-words.js";
import { SSO_PROVIDER_PROTOCOL, ssoProviderIcon } from "./ssoProviderKind.js";
import { NO_AUTOFILL_PROPS } from "../utils/no-autofill.js";
import type { AccessDraft, ClaimErrors } from "./accessSettings.js";
import { PROVIDER_TURNED_OFF } from "./ssoProviderChoice.js";
import "./registration-access.css";

/** The identity provider the organisation chose for the company SSO, as the event page shows it. */
export type SsoProviderKind = "entra" | "google" | "generic";

export interface SsoProviderSummary {
  name: string;
  kind: SsoProviderKind;
  /** The provider is turned off: the form stays closed. */
  off?: boolean;
}

const INTRO =
  "You can let only the people of one company register. When a guest signs in, the identity provider sends facts about the guest, called claims. Name one claim and list the values that may register. With Microsoft Entra ID, the claim is usually tid and the value is the tenant ID of the company. Leave both fields empty for no restriction.";
const PROVIDER_HINT = "Chosen on the Access tab of the Registration page.";
const NO_PROVIDER_HINT = "No identity provider is chosen yet. Choose one on the Access tab.";
const MATCH_HINT =
  "A value must match exactly, with capital letters as they are. Never use the end of an email address here: it says where mail goes, not who the person is. A change counts at once, also for guests who have already signed in.";

/** What the read only provider field says: nothing while none is chosen, else the name, the protocol and whether it is turned off. */
function providerValue(provider: SsoProviderSummary | null): string {
  if (provider === null) return "";
  const off = provider.off === true ? PROVIDER_TURNED_OFF : "";
  return `${provider.name} (${SSO_PROVIDER_PROTOCOL})${off}`;
}

/**
 * The restriction of the company SSO to the people of one company: the name of one claim and the values of it that may register.
 * The server takes the two together, so an error on one says what the other is missing. The values are typed one on each line.
 */
export function AccessSsoClaim({
  name,
  values,
  errors,
  disabled,
  provider,
  showProvider,
  note,
  onChange,
}: Readonly<{
  /** The identity provider the event chose, read only above the claim. */
  provider: SsoProviderSummary | null;
  /** The event uses Company SSO: the provider row is there, and says so while none is chosen. Without it the row is left out. */
  showProvider: boolean;
  /** One short info notice under the intro, such as why the fields are off. */
  note?: string;
  name: string;
  values: string;
  errors: ClaimErrors;
  disabled: boolean;
  onChange: (change: Partial<Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">>) => void;
}>) {
  const id = useId();
  const valuesId = `${id}-values`;
  return (
    <div className="access-claim">
      <p className="settings-card-intro">{keepLastWords(INTRO)}</p>
      {note !== undefined && <Notice variant="info">{keepLastWords(note)}</Notice>}
      <div className="mail-transport-section">
        {showProvider && (
          <Input
            label="Identity provider"
            value={providerValue(provider)}
            icon={<i className={`ti ti-${provider === null ? "shield-lock" : ssoProviderIcon(provider.kind)}`} />}
            readOnly
            disabled
            hint={keepLastWords(provider === null ? NO_PROVIDER_HINT : PROVIDER_HINT)}
          />
        )}
        <Input
          label="Claim name"
          value={name}
          disabled={disabled}
          maxLength={SSO_CLAIM_NAME_MAX}
          placeholder="tid"
          error={errors.name}
          {...NO_AUTOFILL_PROPS}
          onChange={(event) => onChange({ sso_claim_name: event.target.value })}
        />
        <div className="at-field access-claim__values">
          <label className="at-label" htmlFor={valuesId}>
            Allowed values
          </label>
          <textarea
            id={valuesId}
            className={`at-textarea${errors.values ? " at-textarea--invalid" : ""}`}
            rows={4}
            // One value on each line stays on its line: a long GUID scrolls sideways and never looks like two values.
            wrap="off"
            value={values}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={errors.values ? true : undefined}
            aria-describedby={`${valuesId}-note`}
            {...NO_AUTOFILL_PROPS}
            onChange={(event) => onChange({ sso_claim_values: event.target.value })}
          />
          <span id={`${valuesId}-note`} className={`at-hint${errors.values ? " at-hint--error" : ""}`}>
            {errors.values ?? keepLastWords(`One value on each line, up to ${SSO_CLAIM_VALUES_MAX}, each up to ${SSO_CLAIM_VALUE_MAX} characters. ${MATCH_HINT}`)}
          </span>
        </div>
      </div>
    </div>
  );
}
