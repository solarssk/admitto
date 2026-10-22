import type { EventCustomFieldType } from "@admitto/shared";
import { CUSTOM_FIELD_TYPES } from "./customFieldType.js";
import "./requirements.css";

export interface FieldTypePickerProps {
  value: EventCustomFieldType;
  onChange: (type: EventCustomFieldType) => void;
  /** The id of the text that names the group (the "Field type" label). */
  labelledBy: string;
  disabled?: boolean;
}

/** The answer types of a custom field as a grid of buttons, one pressed: seven of them do not fit in a row of a dialog, so they
 * wrap, two to a row on a phone. Each has its icon and its name, so the name is not hidden in a tooltip. */
export function FieldTypePicker({ value, onChange, labelledBy, disabled }: Readonly<FieldTypePickerProps>) {
  return (
    <div className="custom-field-types" role="group" aria-labelledby={labelledBy}>
      {CUSTOM_FIELD_TYPES.map((type) => (
        <button
          key={type.value}
          type="button"
          className={`custom-field-types__btn${value === type.value ? " custom-field-types__btn--active" : ""}`}
          aria-pressed={value === type.value}
          disabled={disabled}
          onClick={() => onChange(type.value)}
        >
          <i className={`ti ${type.icon}`} aria-hidden="true" />
          <span>{type.label}</span>
        </button>
      ))}
    </div>
  );
}
