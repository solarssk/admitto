import { Notice, Switch } from "@admitto/ui";
import "./requirements.css";

/** What the switch says it does (D-E6), in plain words: where the answers are hidden, who sees them and how, and what deleting does. */
export const SENSITIVE_EFFECTS =
  "Answers are hidden in lists, search, filters, exports, reports, wallet passes, emails and on the operator card. Only administrators can see them, by clicking Show on the attendee or the request, and every click is recorded in the audit log. Deleting the question deletes its answers.";

/** Said when an existing question becomes sensitive: the exports that are ready and hold its answers go away. */
export const SENSITIVE_ON_EXPORTS = "When you save, exports that are ready and include this question are cancelled.";

/** Said when a sensitive question stops being one: its answers come back into the places they were hidden from. */
export const SENSITIVE_OFF_VISIBLE = "Answers already given to this question will be visible again in lists, filters, exports and the rest.";

export interface SensitiveFieldSwitchProps {
  checked: boolean;
  /** The question being edited is sensitive now (what is saved, not the switch). */
  wasSensitive: boolean;
  /** The question exists: turning the switch moves answers that may be given already. */
  isEdit: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

/** The "Sensitive" switch of the field editor with what it does under it, and a separate warning when an existing question changes sides. */
export function SensitiveFieldSwitch({ checked, wasSensitive, isEdit, disabled, onChange }: Readonly<SensitiveFieldSwitchProps>) {
  const becomesSensitive = isEdit && checked && !wasSensitive;
  const stopsBeingSensitive = isEdit && !checked && wasSensitive;
  return (
    <div className="at-field">
      <div className="custom-field-sensitive">
        <div className="custom-field-sensitive__text">
          <span className="at-label" id="cf-sensitive-label">
            <i className="ti ti-lock" aria-hidden="true" /> Sensitive
          </span>
          <span className="at-hint" id="cf-sensitive-effects">
            {SENSITIVE_EFFECTS}
          </span>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          aria-labelledby="cf-sensitive-label"
          aria-describedby="cf-sensitive-effects"
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
      {becomesSensitive && <span className="at-hint">{SENSITIVE_ON_EXPORTS}</span>}
      {stopsBeingSensitive && (
        <Notice variant="warning" as="output">
          {SENSITIVE_OFF_VISIBLE}
        </Notice>
      )}
    </div>
  );
}
