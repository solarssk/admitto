import { CONTACT_PHONE_MIN_DIGITS, type EventCustomFieldType } from "@admitto/shared";
import { Input, Switch } from "@admitto/ui";
import { rulesLengthCap, type RulesDraft, type RulesProblems } from "./fieldRules.js";
import "./requirements.css";

export interface FieldRulesEditorProps {
  type: EventCustomFieldType;
  draft: RulesDraft;
  problems: RulesProblems;
  onChange: (draft: RulesDraft) => void;
  /** The field is being saved: the boxes stay on screen, with what they hold, and take no change. */
  saving: boolean;
}

/** A length box takes digits only: a letter or a minus sign has no place in it. */
function digitsOf(text: string): string {
  return text.replaceAll(/\D/g, "");
}

function lengthsHint(type: EventCustomFieldType, cap: number): string {
  if (type === "phone") {
    return `Counted on the saved number: a leading + and its digits, ${CONTACT_PHONE_MIN_DIGITS} to ${cap} characters.`;
  }
  return `Whole numbers, up to ${cap} characters.`;
}

/**
 * The format rules of a text, long text or phone field: its shortest and longest answer, digits only, and an example. A rule that
 * is left empty is not a rule. What the lengths may be depends on the type (what it holds), so a problem is said here, where the
 * boxes are, and not left for the server to refuse. One line under the two lengths holds either what they take or what is wrong
 * with them, so that the form below does not move when an error comes and goes.
 */
export function FieldRulesEditor({ type, draft, problems, onChange, saving }: Readonly<FieldRulesEditorProps>) {
  const cap = rulesLengthCap(type);
  if (cap === null) return null;
  const lengths = problems.lengths;
  return (
    <fieldset className="field-rules" aria-labelledby="cf-rules-title">
      <span className="at-label" id="cf-rules-title">
        Format rules
      </span>
      <span className="at-hint">Optional. An answer that breaks a rule is refused.</span>
      <div className="field-rules__panel">
        <div className="field-rules__lengths">
          <Input
            id="cf-rules-min"
            label="Shortest answer"
            inputMode="numeric"
            autoComplete="off"
            placeholder="No minimum"
            value={draft.minLength}
            readOnly={saving}
            invalid={lengths?.min}
            aria-describedby="cf-rules-lengths-note"
            onChange={(e) => onChange({ ...draft, minLength: digitsOf(e.target.value) })}
          />
          <Input
            id="cf-rules-max"
            label="Longest answer"
            inputMode="numeric"
            autoComplete="off"
            placeholder="No maximum"
            value={draft.maxLength}
            readOnly={saving}
            invalid={lengths?.max}
            aria-describedby="cf-rules-lengths-note"
            onChange={(e) => onChange({ ...draft, maxLength: digitsOf(e.target.value) })}
          />
        </div>
        <div className="field-rules__note" id="cf-rules-lengths-note">
          {lengths ? (
            <span className="at-hint at-hint--error" role="alert">
              {lengths.message}
            </span>
          ) : (
            <span className="at-hint">{lengthsHint(type, cap)}</span>
          )}
        </div>
        <div className="at-field">
          <Switch
            label="Digits only"
            checked={draft.digitsOnly}
            aria-disabled={saving || undefined}
            aria-describedby="cf-rules-digits-hint"
            onChange={(e) => {
              if (!saving) onChange({ ...draft, digitsOnly: e.target.checked });
            }}
          />
          <span className="at-hint" id="cf-rules-digits-hint">
            {type === "phone"
              ? "Only the digits 0 to 9, so a number written with a + is refused."
              : "Only the digits 0 to 9: no spaces, dashes or letters."}
          </span>
        </div>
        <Input
          id="cf-rules-example"
          label="Example"
          autoComplete="off"
          placeholder={type === "phone" ? "+1 555 0100" : "A sample answer"}
          value={draft.example}
          readOnly={saving}
          error={problems.example}
          hint="A hint for the person answering. It is never checked."
          onChange={(e) => onChange({ ...draft, example: e.target.value })}
        />
      </div>
    </fieldset>
  );
}
