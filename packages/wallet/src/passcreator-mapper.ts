import type { WalletPassInput } from "./types.js";

/**
 * Placeholder tokens a wallet field mapping can reference. Matches the mail-template placeholder
 * vocabulary (packages/mail-templates/src/placeholders.ts) where the underlying value already
 * exists on WalletPassInput - not the full mail set, since ticket_url-style mail-only tokens have
 * no meaning on a wallet pass. Exported so the admin API can validate a submitted mapping's values
 * against the same list this mapper actually resolves.
 */
export const WALLET_MAPPING_PLACEHOLDERS = [
  "full_name",
  "first_name",
  "last_name",
  "email",
  "company",
  "department",
  "event_name",
  "event_date",
  "event_hours",
  "event_location",
  "directions_text",
  "accessibility_text",
  "google_maps_url",
  "apple_maps_url",
  "object_name",
  "street",
  "postcode",
  "city",
  "region",
  "country",
  "ticket_type",
] as const;

function walletPlaceholderValues(input: WalletPassInput): Record<string, string | undefined> {
  return {
    full_name: input.attendeeName,
    first_name: input.attendeeFirstNameLabel,
    last_name: input.attendeeLastNameLabel,
    email: input.attendeeEmailLabel,
    company: input.attendeeCompanyLabel,
    department: input.attendeeDepartmentLabel,
    event_name: input.eventNameLabel,
    event_date: input.eventDateLabel,
    event_hours: input.eventHoursLabel,
    event_location: input.eventLocationLabel,
    directions_text: input.directionsTextLabel,
    accessibility_text: input.accessibilityTextLabel,
    google_maps_url: input.googleMapsUrlLabel,
    apple_maps_url: input.appleMapsUrlLabel,
    object_name: input.addressObjectNameLabel,
    street: input.addressStreetLabel,
    postcode: input.addressPostcodeLabel,
    city: input.addressCityLabel,
    region: input.addressRegionLabel,
    country: input.addressCountryLabel,
    ticket_type: input.ticketTypeLabel,
  };
}

/**
 * Maps Admitto's neutral WalletPassInput to a PassCreator `data` payload.
 *
 * Confirmed live against app.passcreator.com 2026-08-06: `templateId`,
 * `userProvidedId`, and `enforceUniqueUserProvidedId` all live INSIDE the
 * `data` object, not as siblings — `_ops/PASSCREATOR-INTEGRATION-DOCS.md`'s
 * example (siblings) does not match the real API.
 *
 * Custom template fields default to `name`/`eventDate`/`eventHours`/`eventPlace`/`ticketType`
 * (ADR 0041 §3a, this specific template's keys) - an admin can override which PassCreator key
 * gets which value via `fieldMapping` (Event Settings -> Wallet) for a different template.
 */
export function toPassCreatorData(
  input: WalletPassInput,
  templateId: string,
  fieldMapping?: Record<string, string>,
): Record<string, unknown> {
  const base = {
    templateId,
    userProvidedId: input.userProvidedId,
    enforceUniqueUserProvidedId: true,
  };
  if (fieldMapping && Object.keys(fieldMapping).length > 0) {
    const values = walletPlaceholderValues(input);
    const custom: Record<string, unknown> = {};
    for (const [key, placeholder] of Object.entries(fieldMapping)) {
      const value = values[placeholder];
      if (value) custom[key] = value;
    }
    return { ...base, ...custom };
  }
  return {
    ...base,
    name: input.attendeeName,
    eventDate: input.eventDateLabel,
    ...(input.eventHoursLabel ? { eventHours: input.eventHoursLabel } : {}),
    ...(input.eventLocationLabel ? { eventPlace: input.eventLocationLabel } : {}),
    ticketType: input.ticketTypeLabel,
  };
}
