import { WALLET_MAPPING_PLACEHOLDERS } from "@admitto/wallet/passcreator-mapper";

/** One editable row of the Wallet field mapping - PassCreator field key -> Admitto placeholder.
 * `id` is a client-only React key, generated once per row (never sent to the server) - the
 * server's own mapping shape is a plain key->placeholder record with no row identity. */
export type WalletFieldMappingRow = { id: string; key: string; value: string };

/** Label + icon per placeholder, one entry each - the icon groups the Value dropdown's options by
 * category so the list is easier to scan (matches WALLET_MAPPING_PLACEHOLDERS' existing grouping
 * order: attendee, event, notes, maps, address, ticket) instead of relying on option order alone. */
const WALLET_PLACEHOLDER_META: Record<
  (typeof WALLET_MAPPING_PLACEHOLDERS)[number],
  { label: string; icon: string }
> = {
  full_name: { label: "Attendee full name", icon: "user" },
  first_name: { label: "Attendee first name", icon: "user" },
  last_name: { label: "Attendee last name", icon: "user" },
  email: { label: "Attendee email", icon: "user" },
  company: { label: "Attendee company", icon: "user" },
  department: { label: "Attendee department", icon: "user" },
  event_name: { label: "Event name", icon: "calendar-event" },
  event_date: { label: "Event date", icon: "calendar-event" },
  event_date_short: { label: "Event date (short)", icon: "calendar-event" },
  event_hours: { label: "Event hours", icon: "calendar-event" },
  event_location: { label: "Event location", icon: "calendar-event" },
  directions_text: { label: "Directions", icon: "notes" },
  accessibility_text: { label: "Accessibility notes", icon: "notes" },
  google_maps_url: { label: "Google Maps URL", icon: "map" },
  apple_maps_url: { label: "Apple Maps URL", icon: "map" },
  object_name: { label: "Venue name", icon: "map-pin" },
  street: { label: "Street address", icon: "map-pin" },
  postcode: { label: "Postal code", icon: "map-pin" },
  city: { label: "City", icon: "map-pin" },
  region: { label: "Region", icon: "map-pin" },
  country: { label: "Country", icon: "map-pin" },
  ticket_type: { label: "Ticket type", icon: "ticket" },
  ticket_url: { label: "Ticket/QR value", icon: "ticket" },
  event_type: { label: "Event type", icon: "category" },
  venue_room: { label: "Venue room", icon: "map-pin" },
  venue_entrance: { label: "Venue entrance", icon: "map-pin" },
  venue_entrance_door: { label: "Entrance door", icon: "map-pin" },
  venue_entrance_gate: { label: "Entrance gate", icon: "map-pin" },
  venue_entrance_portal: { label: "Entrance portal", icon: "map-pin" },
  venue_phone_number: { label: "Venue phone number", icon: "phone" },
  venue_place_id: { label: "Venue place ID", icon: "map-pin" },
  venue_open_time: { label: "Venue open time", icon: "clock" },
  venue_close_time: { label: "Venue close time", icon: "clock" },
  doors_open_time: { label: "Doors open time", icon: "clock" },
  gates_open_time: { label: "Gates open time", icon: "clock" },
  box_office_open_time: { label: "Box office open time", icon: "clock" },
  parking_lots_open_time: { label: "Parking lots open time", icon: "clock" },
  fan_zone_open_time: { label: "Fan zone open time", icon: "clock" },
};

export const WALLET_PLACEHOLDER_OPTIONS = WALLET_MAPPING_PLACEHOLDERS.map((id) => ({
  id,
  icon: WALLET_PLACEHOLDER_META[id].icon,
  label: WALLET_PLACEHOLDER_META[id].label,
}));

/** Renders field mapping rows grouped by category (attendee, event, notes, maps, address,
 * ticket - WALLET_MAPPING_PLACEHOLDERS' own order) instead of insertion order, so a row's
 * position is always determined by what it's mapped to, never by editing history. A row with no
 * value picked yet (freshly added) sorts last, since it has no category to group under. Returns
 * a new array - never mutates the form state array itself. */
export function sortWalletFieldMappingByCategory(rows: WalletFieldMappingRow[]): WalletFieldMappingRow[] {
  const categoryRank = (value: string): number => {
    const index = WALLET_MAPPING_PLACEHOLDERS.indexOf(value as (typeof WALLET_MAPPING_PLACEHOLDERS)[number]);
    return index === -1 ? WALLET_MAPPING_PLACEHOLDERS.length : index;
  };
  return [...rows].sort((a, b) => categoryRank(a.value) - categoryRank(b.value));
}

/** Extracted out of buildWalletPatch to keep its own cognitive complexity under the SonarCloud
 * threshold (S3776, same reasoning as this file's other buildXPatch helpers). */
export function buildWalletFieldMappingPatch(rows: WalletFieldMappingRow[]): Record<string, string> | null {
  const mapping: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key && row.value) mapping[key] = row.value;
  }
  return Object.keys(mapping).length > 0 ? mapping : null;
}

/** buildWalletFieldMappingPatch silently drops a row with a value but no key, and lets a later
 * row's key overwrite an earlier one - both intentional (a half-filled-in row shouldn't block
 * saving the rest), but neither has any other signal. Surfaced here so the Wallet tab's own
 * SettingsFooter can show it instead of the row just quietly not being there after "Event
 * settings saved". */
export function computeWalletFieldMappingErrors(rows: WalletFieldMappingRow[]): string[] {
  const errors: string[] = [];
  const keyCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.key.trim();
    if (row.value && !key) {
      const label = WALLET_PLACEHOLDER_OPTIONS.find((o) => o.id === row.value)?.label ?? row.value;
      errors.push(`"${label}" has no PassCreator field key - this row won't be saved.`);
    }
    if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of keyCounts) {
    if (count > 1) errors.push(`The key "${key}" is used by more than one row - only the last one will be saved.`);
  }
  return errors;
}
