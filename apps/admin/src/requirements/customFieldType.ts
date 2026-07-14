/** The 3 EventCustomField data types, with the icon shown for each everywhere in Requirements. */
export const CUSTOM_FIELD_TYPES = [
  { value: "text", icon: "ti-letter-case", label: "Text" },
  { value: "select", icon: "ti-list", label: "Select" },
  { value: "boolean", icon: "ti-checkbox", label: "Boolean" },
] as const;

export function customFieldTypeIcon(type: string): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === type)?.icon ?? "ti-letter-case";
}
