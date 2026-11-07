import type { EventCustomFieldType } from "@admitto/shared";
import { CUSTOM_FIELD_TYPES } from "./customFieldType.js";
import { FieldChoicePicker } from "./FieldChoicePicker.js";

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
  return <FieldChoicePicker choices={CUSTOM_FIELD_TYPES} value={value} onChange={onChange} labelledBy={labelledBy} disabled={disabled} />;
}
