import type { EventCustomFieldRecipient } from "../api/types.js";
import { FieldChoicePicker } from "./FieldChoicePicker.js";

/** Whose answer a question asks for, as the editor names it: the guest's own, or the person the guest brings (D-E5). */
export const FIELD_RECIPIENTS: readonly { value: EventCustomFieldRecipient; icon: string; label: string; hint: string }[] = [
  {
    value: "guest",
    icon: "ti-user",
    label: "Guest",
    hint: "Asked of the guest. It is part of the attendee's own details, the attendee form, imports and exports.",
  },
  {
    value: "companion",
    icon: "ti-users",
    label: "Companion",
    hint: "Asked about the person the guest brings, and answered on the registration form only when the event lets a guest bring someone. The answer is kept with the companion.",
  },
];

export interface FieldRecipientPickerProps {
  value: EventCustomFieldRecipient;
  onChange: (recipient: EventCustomFieldRecipient) => void;
  /** The id of the text that names the group (the "Applies to" label). */
  labelledBy: string;
  disabled?: boolean;
}

/** The two recipients of a question as a pair of buttons, one pressed. */
export function FieldRecipientPicker({ value, onChange, labelledBy, disabled }: Readonly<FieldRecipientPickerProps>) {
  return <FieldChoicePicker choices={FIELD_RECIPIENTS} value={value} onChange={onChange} labelledBy={labelledBy} disabled={disabled} />;
}
