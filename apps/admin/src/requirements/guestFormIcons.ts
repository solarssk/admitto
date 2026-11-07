import { GUEST_FORM_ICONS, guestFormDrawsIcon, type GuestFormIcon } from "@admitto/shared";
import { customFieldTypeLabel } from "./customFieldType.js";
import type { IconPickerItem } from "./IconPicker.js";

/** What each icon a question can carry on the registration form is called in this app, and the Tabler glyph that draws it here. The name
 * that is stored (`rules.icon`) is the key: the form draws a symbol of its own for it. The glyph is only how the panel shows it, and
 * not every stored name is a Tabler name (`food` is `tools-kitchen-2`, `pin` is `map-pin`), so the mapping is in this one place. A record
 * keyed by the shared list: an icon added to `GUEST_FORM_ICONS` without an entry here does not compile. */
const GUEST_FORM_ICON_INFO: Record<GuestFormIcon, { label: string; tabler: string }> = {
  parking: { label: "Parking", tabler: "parking" },
  car: { label: "Car", tabler: "car" },
  food: { label: "Food", tabler: "tools-kitchen-2" },
  accessible: { label: "Accessibility", tabler: "accessible" },
  bed: { label: "Accommodation", tabler: "bed" },
  "user-plus": { label: "Extra guest", tabler: "user-plus" },
  users: { label: "Group", tabler: "users" },
  building: { label: "Company", tabler: "building" },
  calendar: { label: "Calendar", tabler: "calendar" },
  clock: { label: "Clock", tabler: "clock" },
  phone: { label: "Telephone", tabler: "phone" },
  mail: { label: "Email", tabler: "mail" },
  pin: { label: "Location", tabler: "map-pin" },
  plane: { label: "Flight", tabler: "plane" },
  train: { label: "Train", tabler: "train" },
  shirt: { label: "T-shirt", tabler: "shirt" },
};

/** The icons of the registration form in the order of the shared list, as the icon picker takes them. */
export const GUEST_FORM_ICON_OPTIONS: ReadonlyArray<IconPickerItem> = GUEST_FORM_ICONS.map((name) => ({
  name,
  label: GUEST_FORM_ICON_INFO[name].label,
  tabler: GUEST_FORM_ICON_INFO[name].tabler,
}));

/** The icon of the registration form that has this name, or null for no icon and for a name that is not in the list. The icon picker
 * hands back a plain string, and the rules of a field hold only a name of the list. */
export function guestFormIconNamed(name: string | null): GuestFormIcon | null {
  return GUEST_FORM_ICONS.find((icon) => icon === name) ?? null;
}

/** The Tabler glyph for the icon of a question, or undefined for no icon and for a name this version does not know (a newer
 * server, an older record). */
export function guestFormIconGlyph(name: string | undefined): string | undefined {
  return GUEST_FORM_ICON_OPTIONS.find((icon) => icon.name === name)?.tabler;
}

/** What the icon of a question is called, or undefined for no icon and for a name this version does not know. */
export function guestFormIconLabel(name: string | undefined): string | undefined {
  return GUEST_FORM_ICON_OPTIONS.find((icon) => icon.name === name)?.label;
}

/** What to tell an organiser who has chosen an icon for a question of this kind that the registration form does not draw it for (a single
 * choice, a long text, a required yes/no question: `guestFormDrawsIcon`), or an empty text when it is drawn. The icon is saved either way. */
export function iconNotDrawnMessage(type: string, required: boolean): string {
  if (guestFormDrawsIcon({ type, required })) return "";
  const kind = type === "boolean" ? "A required Yes / No question" : `A ${customFieldTypeLabel(type)} question`;
  return `${kind} shows no icon on the registration form. The icon stays saved.`;
}
