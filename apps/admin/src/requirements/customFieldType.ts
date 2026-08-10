/** The 3 EventCustomField data types, with the icon shown for each everywhere in Requirements. */
export const CUSTOM_FIELD_TYPES = [
  { value: "text", icon: "ti-letter-case", label: "Text", hint: "Free text (one line)." },
  {
    value: "select",
    icon: "ti-list",
    label: "Single choice",
    hint: "Operator picks one option from a list you define.",
  },
  { value: "boolean", icon: "ti-checkbox", label: "Yes / No", hint: "A simple yes or no flag." },
] as const;

export function customFieldTypeIcon(type: string): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.icon ?? "ti-letter-case";
}

export function customFieldTypeLabel(type: string): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}
