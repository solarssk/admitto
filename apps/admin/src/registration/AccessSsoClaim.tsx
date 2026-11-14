import { useId } from "react";
import { SSO_CLAIM_NAME_MAX, SSO_CLAIM_VALUE_MAX, SSO_CLAIM_VALUES_MAX } from "@admitto/shared";
import { Input } from "@admitto/ui";
import { NO_AUTOFILL_PROPS } from "../utils/no-autofill.js";
import type { AccessDraft, ClaimErrors } from "./accessSettings.js";
import "./registration-access.css";

const INTRO =
  "Optionally let only the people of one company register. The identity provider vouches for the person with a claim in the sign-in: you name the claim and list the values that may register. With Microsoft Entra ID, the claim is usually tid and the value is the tenant ID of the company (a GUID). Leave both empty for no restriction.";
const SUPERADMIN_ONLY = "Only a superadmin can change this.";
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
  canEdit,
  onChange,
}: Readonly<{
  name: string;
  values: string;
  errors: ClaimErrors;
  disabled: boolean;
  /** Only a superadmin changes the restriction (the server refuses anyone else); for the rest the fields are read only. */
  canEdit: boolean;
  onChange: (change: Partial<Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">>) => void;
}>) {
  const id = useId();
  const valuesId = `${id}-values`;
  // A read only field cannot be typed in; this keeps it so for a change that comes some other way.
  const edit = (change: Partial<Pick<AccessDraft, "sso_claim_name" | "sso_claim_values">>) => {
    if (canEdit) onChange(change);
  };
  return (
    <div className="access-claim">
      <p className="settings-card-intro">{INTRO}</p>
      {!canEdit && <p className="settings-card-intro">{SUPERADMIN_ONLY}</p>}
      <Input
        label="Claim name"
        value={name}
        disabled={disabled}
        readOnly={!canEdit}
        maxLength={SSO_CLAIM_NAME_MAX}
        placeholder="tid"
        error={errors.name}
        {...NO_AUTOFILL_PROPS}
        onChange={(event) => edit({ sso_claim_name: event.target.value })}
      />
      <div className="at-field">
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
          readOnly={!canEdit}
          spellCheck={false}
          aria-invalid={errors.values ? true : undefined}
          aria-describedby={`${valuesId}-note`}
          {...NO_AUTOFILL_PROPS}
          onChange={(event) => edit({ sso_claim_values: event.target.value })}
        />
        <span id={`${valuesId}-note`} className={`settings-card-intro${errors.values ? " at-hint--error" : ""}`}>
          {errors.values ?? `One value on each line, up to ${SSO_CLAIM_VALUES_MAX}, each up to ${SSO_CLAIM_VALUE_MAX} characters. ${MATCH_HINT}`}
        </span>
      </div>
    </div>
  );
}
