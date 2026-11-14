import "./requirements.css";

export interface FieldChoice<T extends string> {
  value: T;
  icon: string;
  label: string;
}

export interface FieldChoicePickerProps<T extends string> {
  choices: readonly FieldChoice<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The id of the text that names the group (the "Field type" label). */
  labelledBy: string;
  disabled?: boolean;
}

/** One choice of a field's settings as a grid of buttons, one pressed: the answer types and whose answer a field asks for. The buttons
 * wrap (seven types do not fit in a row of a dialog), two to a row on a phone. Each has its icon and its name, so the name is not hidden
 * in a tooltip. */
export function FieldChoicePicker<T extends string>({ choices, value, onChange, labelledBy, disabled }: Readonly<FieldChoicePickerProps<T>>) {
  return (
    <fieldset className="custom-field-types" aria-labelledby={labelledBy}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className={`custom-field-types__btn${value === choice.value ? " custom-field-types__btn--active" : ""}`}
          aria-pressed={value === choice.value}
          disabled={disabled}
          onClick={() => onChange(choice.value)}
        >
          <i className={`ti ${choice.icon}`} aria-hidden="true" />
          <span>{choice.label}</span>
        </button>
      ))}
    </fieldset>
  );
}
