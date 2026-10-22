import { EVENT_CUSTOM_FIELD_TYPES, type EventCustomFieldType } from "@admitto/shared";

interface CustomFieldTypeInfo {
  icon: string;
  label: string;
  hint: string;
}

/** What each answer type is called and drawn as, everywhere in Requirements and on the Registration page. A record keyed by
 * the shared type, so a type added to `EVENT_CUSTOM_FIELD_TYPES` without an entry here fails to compile. */
const CUSTOM_FIELD_TYPE_INFO: Record<EventCustomFieldType, CustomFieldTypeInfo> = {
  text: {
    icon: "ti-letter-case",
    label: "Text",
    hint: "Attendee types a short answer (e.g. dietary needs, parking spot, company name).",
  },
  long_text: {
    icon: "ti-align-left",
    label: "Long text",
    hint: "Attendee types a longer answer, up to 1000 characters (e.g. accessibility needs, a talk abstract).",
  },
  date: {
    icon: "ti-calendar",
    label: "Date",
    hint: "Attendee picks a calendar day (e.g. arrival day, departure day).",
  },
  datetime: {
    icon: "ti-calendar-time",
    label: "Date and time",
    hint: "Attendee picks a day and a time of day, read as the time at the event (e.g. arrival at the venue).",
  },
  phone: {
    icon: "ti-phone",
    label: "Phone",
    hint: "Attendee types a phone number of 3 to 15 digits (e.g. a mobile number for the day).",
  },
  select: {
    icon: "ti-list",
    label: "Single choice",
    hint: "Attendee picks one option from your list (e.g. S / M / L, vegetarian / vegan).",
  },
  boolean: {
    icon: "ti-checkbox",
    label: "Yes / No",
    hint: "Attendee answers yes or no (e.g. needs accessibility support, brings a guest).",
  },
};

/** The answer types of an event's custom fields, in the order the editor lists them (the order of the shared list), each
 * with the icon shown for it everywhere, its name and a hint for the editor. */
export const CUSTOM_FIELD_TYPES = EVENT_CUSTOM_FIELD_TYPES.map((value) => ({ value, ...CUSTOM_FIELD_TYPE_INFO[value] }));

/** The info of a type, or undefined for a value this version does not know (a newer server, an older record). */
function infoOf(type: string): CustomFieldTypeInfo | undefined {
  return CUSTOM_FIELD_TYPES.find((entry) => entry.value === type);
}

export function customFieldTypeIcon(type: string): string {
  return infoOf(type)?.icon ?? "ti-letter-case";
}

export function customFieldTypeLabel(type: string): string {
  return infoOf(type)?.label ?? type;
}
