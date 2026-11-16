import { useId, type ReactNode } from "react";
import { SSO_CLAIM_NAME_MAX, SSO_CLAIM_VALUE_MAX, SSO_CLAIM_VALUES_MAX } from "@admitto/shared";
import { Input, Notice } from "@admitto/ui";
import { keepLastWords } from "../utils/keep-last-words.js";
import { NO_AUTOFILL_PROPS } from "../utils/no-autofill.js";
import type { AccessDraft, ClaimErrors } from "./accessSettings.js";
import "./registration-access.css";

const INTRO =
  "Limit who can register. The identity provider tells us facts about each guest, called claims. Name a claim and list the values that may register. Example: the claim tid with the ID of your company, so only people of that company can register. A claim that holds a list, such as groups, works too: a guest who is in any listed group can register. Leave both fields empty for no limit.";
const CLAIM_HINT = "The name of the fact to check, for example tid.";
/** Two made-up values, one on each line, to show the shape: the tenant ID of Microsoft Entra ID is a GUID. */
const VALUES_EXAMPLE = "3f2c1a9e-5b7d-4c1e-9a2f-0123456789ab\n7b0e4d21-8a3c-4f6d-b1e5-9876543210fe";
const MATCH_HINT =
  "Values must match exactly, capital letters too. Never use the end of an email address: it says where mail goes, not who the person is. A change counts at once, also for guests who are already signed in.";

/**
 * The restriction of the company SSO to the people of one company: the name of one claim and the values of it that may register.
 * The server takes the two together, so an error on one says what the other is missing. The values are typed one on each line.
 */
export function AccessSsoClaim({
  name,
  values,
  errors,
  disabled,
  providerField,
  note,
  onChange,
}: Readonly<{
  /** The choice of the identity provider, above the claim. */
  providerField: ReactNode;
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
        {providerField}
        <Input
          label="Claim name"
          value={name}
          disabled={disabled}
          maxLength={SSO_CLAIM_NAME_MAX}
          placeholder="tid"
          hint={keepLastWords(CLAIM_HINT)}
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
            placeholder={VALUES_EXAMPLE}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={errors.values ? true : undefined}
            aria-describedby={`${valuesId}-note`}
            {...NO_AUTOFILL_PROPS}
            onChange={(event) => onChange({ sso_claim_values: event.target.value })}
          />
          <span id={`${valuesId}-note`} className={`at-hint${errors.values ? " at-hint--error" : ""}`}>
            {errors.values ?? keepLastWords(`One value on each line, up to ${SSO_CLAIM_VALUES_MAX}, each up to ${SSO_CLAIM_VALUE_MAX} characters. The grey lines are an example, not values. ${MATCH_HINT}`)}
          </span>
        </div>
      </div>
    </div>
  );
}
