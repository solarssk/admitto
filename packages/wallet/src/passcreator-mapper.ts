import type { WalletPassInput } from "./types.js";

/**
 * Placeholder tokens a wallet field mapping can reference. Matches the mail-template placeholder
 * vocabulary (packages/mail-templates/src/placeholders.ts) where the underlying value already
 * exists on WalletPassInput. Exported so the admin API can validate a submitted mapping's values
 * against the same list this mapper actually resolves.
 *
 * `ticket_url` is the same payload sent as the top-level `barcodeValue` API field (input.barcodeValue).
 * Some PassCreator templates' Barcode Value box is bound to a fixed placeholder like
 * {userProvidedId} instead of reading barcodeValue - mapping ticket_url to a registered Additional
 * Property lets an admin re-point that box at {theirPropertyName} so the pass's actual barcode
 * matches the ticket.
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
  "ticket_url",
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
    ticket_url: input.barcodeValue,
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
 * No default field mapping: PassCreator templates don't share a common set of Additional
 * Property names, so guessing keys like `name`/`eventDate` only ever matched one specific
 * template and silently sent nothing for every other one. An admin maps every field their
 * template's Additional Properties expect via `fieldMapping` (Event Settings -> Wallet) -
 * nothing beyond `base` is sent when it's empty.
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
    // Top-level API field (not a template Additional Property, not part of fieldMapping) that
    // controls the pass's actual scanned barcode content - without it PassCreator falls back to
    // its own template-configured default (typically its own auto-generated pass UID), which
    // does not match any real Admitto ticket.
    barcodeValue: input.barcodeValue,
  };
  if (!fieldMapping) return base;

  const values = walletPlaceholderValues(input);
  const custom: Record<string, unknown> = {};
  for (const [key, placeholder] of Object.entries(fieldMapping)) {
    const value = values[placeholder];
    if (value) custom[key] = value;
  }
  return { ...base, ...custom };
}
