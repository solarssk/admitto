import { useId } from "react";
import { SSO_CLAIM_NAME_MAX, SSO_CLAIM_VALUE_MAX, SSO_CLAIM_VALUES_MAX } from "@admitto/shared";
import { Input, Notice } from "@admitto/ui";
import { SSO_PROVIDER_PROTOCOL, ssoProviderIcon } from "./ssoProviderKind.js";
import { NO_AUTOFILL_PROPS } from "../utils/no-autofill.js";
import type { AccessDraft, ClaimErrors } from "./accessSettings.js";
import "./registration-access.css";

/** The identity provider the organisation chose for the company SSO, as the event page shows it. */
export type SsoProviderKind = "entra" | "google" | "generic";

export interface SsoProviderSummary {
  name: string;
  kind: SsoProviderKind;
}

const INTRO =
  "Optionally let only the people of one company register: the identity provider (OpenID Connect, such as Microsoft Entra ID) vouches for them with a claim in the sign-in. Name the claim and list the values that may register; with Entra ID the claim is usually tid and the value the tenant ID of the company. Leave both empty for no restriction.";
const PROVIDER_HINT = "Chosen for the organisation, in Organisation settings, Identity.";
const MATCH_HINT =
  "A value must match exactly, with capital letters as they are. Never use the end of an email address here: it says where mail goes, not who the person is. A change counts at once, also for guests who have already signed in.";

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
  note,
  onChange,
}: Readonly<{
  /** The identity provider chosen for the organisation, read only above the claim; none leaves the row out. */
  provider: SsoProviderSummary | null;
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
      <p className="settings-card-intro">{INTRO}</p>
      {note !== undefined && <Notice variant="info">{note}</Notice>}
      <div className="mail-transport-section">
        {provider !== null && (
          <Input
            label="Identity provider"
            value={`${provider.name} (${SSO_PROVIDER_PROTOCOL})`}
            icon={<i className={`ti ti-${ssoProviderIcon(provider.kind)}`} />}
            readOnly
            disabled
            hint={PROVIDER_HINT}
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
            {errors.values ?? `One value on each line, up to ${SSO_CLAIM_VALUES_MAX}, each up to ${SSO_CLAIM_VALUE_MAX} characters. ${MATCH_HINT}`}
          </span>
        </div>
      </div>
    </div>
  );
}
