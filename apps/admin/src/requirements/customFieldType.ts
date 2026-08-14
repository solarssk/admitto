/** The 3 EventCustomField data types, with the icon shown for each everywhere in Requirements. */
export const CUSTOM_FIELD_TYPES = [
  {
    value: "text",
    icon: "ti-letter-case",
    label: "Text",
    hint: "Attendee types a short answer (e.g. dietary needs, parking spot, company name).",
  },
  {
    value: "select",
    icon: "ti-list",
    label: "Single choice",
    hint: "Attendee picks one option from your list (e.g. S / M / L, vegetarian / vegan).",
  },
  {
    value: "boolean",
    icon: "ti-checkbox",
    label: "Yes / No",
    hint: "Attendee answers yes or no (e.g. needs accessibility support, brings a guest).",
  },
] as const;

export function customFieldTypeIcon(type: string): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.icon ?? "ti-letter-case";
}

export function customFieldTypeLabel(type: string): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}
