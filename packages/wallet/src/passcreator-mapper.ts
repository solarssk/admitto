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
  "event_date_short",
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
  "event_type",
  "venue_room",
  "venue_entrance",
  "venue_entrance_door",
  "venue_entrance_gate",
  "venue_entrance_portal",
  "venue_phone_number",
  "venue_place_id",
  "venue_open_time",
  "venue_close_time",
  "doors_open_time",
  "gates_open_time",
  "box_office_open_time",
  "parking_lots_open_time",
  "fan_zone_open_time",
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
    event_date_short: input.eventDateShortLabel,
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
    event_type: input.eventTypeLabel,
    venue_room: input.venueRoomLabel,
    venue_entrance: input.venueEntranceLabel,
    venue_entrance_door: input.venueEntranceDoorLabel,
    venue_entrance_gate: input.venueEntranceGateLabel,
    venue_entrance_portal: input.venueEntrancePortalLabel,
    venue_phone_number: input.venuePhoneNumberLabel,
    venue_place_id: input.venuePlaceIdLabel,
    venue_open_time: input.venueOpenTimeLabel,
    venue_close_time: input.venueCloseTimeLabel,
    doors_open_time: input.doorsOpenTimeLabel,
    gates_open_time: input.gatesOpenTimeLabel,
    box_office_open_time: input.boxOfficeOpenTimeLabel,
    parking_lots_open_time: input.parkingLotsOpenTimeLabel,
    fan_zone_open_time: input.fanZoneOpenTimeLabel,
  };
}

/**
 * Maps Admitto's neutral WalletPassInput to a PassCreator `data` payload.
 *
 * Confirmed live against app.passcreator.com 2026-08-06: `templateId`,
 * `userProvidedId`, and `enforceUniqueUserProvidedId` all live INSIDE the
 * `data` object, not as siblings.
 *
 * No default field mapping: PassCreator templates don't share a common set of Additional
 * Property names, so guessing keys like `name`/`eventDate` only ever matched one specific
 * template and silently sent nothing for every other one. An admin maps every field their
 * template's Additional Properties expect via `fieldMapping` (Event Settings -> Wallet) -
 * nothing beyond `base` is sent when it's empty.
 *
 * `enforceUnique` must be true only for create (reject if some OTHER pass already owns this
 * userProvidedId) and false for update (per PassCreator's own docs, `enforceUniqueUserProvidedId:
 * true` rejects with 400 "already used within your account" - on an update the id being sent is
 * always already used, by the very pass being updated, so leaving this true unconditionally broke
 * every reissue with a false "not unique" error - found live, 2026-08-13).
 */
export function toPassCreatorData(
  input: WalletPassInput,
  templateId: string,
  fieldMapping: Record<string, string> | undefined,
  enforceUnique: boolean,
): Record<string, unknown> {
  const base = {
    templateId,
    userProvidedId: input.userProvidedId,
    enforceUniqueUserProvidedId: enforceUnique,
    // Top-level API field (not a template Additional Property, not part of fieldMapping) that
    // controls the pass's actual scanned barcode content - without it PassCreator falls back to
    // its own template-configured default (typically its own auto-generated pass UID), which
    // does not match any real Admitto ticket.
    barcodeValue: input.barcodeValue,
    // Another top-level API field, not a fieldMapping placeholder: controls Lock Screen surfacing
    // (PassCreator docs, POST /api/v3/pass). Omitted (not sent as an explicit null/empty string)
    // when Admitto has no start time to anchor it to.
    ...(input.relevantDate ? { relevantDate: input.relevantDate } : {}),
  };

  if (!fieldMapping) return base;

  const values = walletPlaceholderValues(input);
  const custom: Record<string, unknown> = {};
  for (const [key, placeholder] of Object.entries(fieldMapping)) {
    const value = values[placeholder];
    if (value) custom[key] = value;
  }
  // base last: an admin's own field-mapping key (e.g. accidentally named "userProvidedId" or
  // "barcodeValue" after PassCreator's own API vocabulary) must never override the provider-
  // controlled identity/QR fields - those decide idempotency and which pass the barcode matches.
  return { ...custom, ...base };
}

/**
 * Which WALLET_MAPPING_PLACEHOLDERS token(s) each WALLET_RELEVANT_EVENT_FIELDS /
 * _LOCATION_FIELDS / _ATTENDEE_FIELDS entry (packages/shared/src/walletPushRelevantFields.ts)
 * actually feeds, derived from buildWalletPassInput (packages/tickets/src/wallet-pass-input.ts).
 * A field only reaches the pass when an admin has actually mapped one of its placeholders to a
 * PassCreator Additional Property - when `fieldMapping` is empty, toPassCreatorData above sends
 * nothing beyond `base`, so editing an unmapped field (e.g. `event_type` with no template field
 * pointed at it) cannot change any already-issued pass. `date` and `event_hours_start` also feed
 * `relevantDate` (computeRelevantDate) - see {@link isRelevantDateAffected}, checked separately by
 * callers since that channel is gated on live event state (wallet_apple_enabled AND an actual
 * start time), not on fieldMapping. `wallet_apple_enabled` has no placeholder of its own at all -
 * relevantDate is its only channel to an issued pass. `timezone` has no placeholder of its own but
 * changes what `event_hours`/the venue access-point time placeholders render, since
 * wallet-pass-input.ts reads `event.timezone` when formatting all of them.
 */
export const EVENT_FIELD_PLACEHOLDERS: Record<string, readonly string[]> = {
  title: ["event_name"],
  date: ["event_date", "event_date_short"],
  timezone: [
    "event_hours",
    "venue_open_time",
    "venue_close_time",
    "doors_open_time",
    "gates_open_time",
    "box_office_open_time",
    "parking_lots_open_time",
    "fan_zone_open_time",
  ],
  event_hours_start: ["event_hours"],
  event_hours_end: ["event_hours"],
  event_type: ["event_type"],
  wallet_apple_enabled: [],
};

/** Location counterpart of {@link EVENT_FIELD_PLACEHOLDERS}. `venue_name` feeds `event_location`
 * directly (`eventLocationLabel: event.location || undefined`) and also feeds both maps-URL
 * placeholders, since wallet-pass-input.ts's own `mapLabel` (the text label baked into both
 * generated map URLs) is `event.location ?? event.formattedAddress` - venue_name preferred,
 * formatted_address only as a fallback when venue_name is empty. `formatted_address` therefore
 * feeds *only* the maps-URL placeholders, never `event_location` itself (bot review: the previous
 * version had this backwards - formatted_address claimed event_location it doesn't feed, and
 * venue_name was missing the maps-URL placeholders it does). `latitude`/`longitude` together gate
 * whether either maps-URL placeholder is populated at all (`isMapReady`), so both feed both.
 * `address_components` also feeds `event_date`/`event_date_short`/`event_hours` (EVENT
 * placeholders) alongside its own address placeholders - wallet-pass-input.ts passes
 * `addressComponents.country` into `formatDate`/`formatDateShort`/`formatEventHours` for
 * country-dependent formatting, so a country change can alter all three even though it's a
 * Location-tab field (bot review). */
export const LOCATION_FIELD_PLACEHOLDERS: Record<string, readonly string[]> = {
  venue_name: ["event_location", "google_maps_url", "apple_maps_url"],
  formatted_address: ["google_maps_url", "apple_maps_url"],
  latitude: ["google_maps_url", "apple_maps_url"],
  longitude: ["google_maps_url", "apple_maps_url"],
  directions_text: ["directions_text"],
  accessibility_text: ["accessibility_text"],
  address_components: [
    "object_name",
    "street",
    "postcode",
    "city",
    "region",
    "country",
    "event_date",
    "event_date_short",
    "event_hours",
  ],
  google_maps_url_override: ["google_maps_url"],
  apple_maps_url_override: ["apple_maps_url"],
  venue_room: ["venue_room"],
  venue_entrance: ["venue_entrance"],
  venue_entrance_door: ["venue_entrance_door"],
  venue_entrance_gate: ["venue_entrance_gate"],
  venue_entrance_portal: ["venue_entrance_portal"],
  venue_phone_number: ["venue_phone_number"],
  venue_place_id: ["venue_place_id"],
  venue_open_time: ["venue_open_time"],
  venue_close_time: ["venue_close_time"],
  doors_open_time: ["doors_open_time"],
  gates_open_time: ["gates_open_time"],
  box_office_open_time: ["box_office_open_time"],
  parking_lots_open_time: ["parking_lots_open_time"],
  fan_zone_open_time: ["fan_zone_open_time"],
};

/** Attendee counterpart of {@link EVENT_FIELD_PLACEHOLDERS}. `first_name`/`last_name` also feed
 * `full_name`: `applyNamePatchFields` rebuilds `Attendee.name` from the pair whenever either
 * changes, and `attendeeName` (fed into the `full_name` placeholder) is that same `name` column -
 * a template mapping only `full_name` (the common case) would otherwise see a split-name edit as
 * irrelevant even though it changes what `full_name` renders (bot review). */
export const ATTENDEE_FIELD_PLACEHOLDERS: Record<string, readonly string[]> = {
  first_name: ["first_name", "full_name"],
  last_name: ["last_name", "full_name"],
  email: ["email"],
  company: ["company"],
  department: ["department"],
  ticket_type: ["ticket_type"],
};

/**
 * True when changing `field` on an event/location/attendee with already-issued wallet passes can
 * actually alter what's on those passes, given the event's current `fieldMapping`
 * (`Event.wallet_field_mapping`; null/empty means no custom placeholders are sent at all, see
 * `toPassCreatorData` above). A field missing from `table` fails open (treated as relevant)
 * rather than silently under-warning - every WALLET_RELEVANT_*_FIELDS entry is expected to have a
 * `table` entry, enforced by a coverage test. Does NOT by itself account for the relevantDate
 * channel (`date`/`event_hours_start`/`wallet_apple_enabled`) - callers combine this with
 * {@link isRelevantDateAffected} for those three fields.
 */
export function isWalletFieldMappingRelevant(
  field: string,
  table: Record<string, readonly string[]>,
  fieldMapping: Record<string, string> | null | undefined,
): boolean {
  const placeholders = table[field];
  if (placeholders === undefined) return true;
  if (!fieldMapping) return false;
  const mapped = new Set(Object.values(fieldMapping));
  return placeholders.some((p) => mapped.has(p));
}

/** Event state relevantDate (computeRelevantDate, packages/tickets/src/wallet-pass-input.ts)
 * actually depends on - `walletAppleEnabled && !!eventHoursStart`. Its own gate, entirely separate
 * from fieldMapping: relevantDate is a top-level PassCreator API field sent unconditionally
 * whenever it has a value, never gated on any Additional Property mapping. */
export type RelevantDateState = { walletAppleEnabled: boolean; eventHoursStart: string | null };

/**
 * True when a `date`, `event_hours_start`, or `wallet_apple_enabled` change could alter
 * relevantDate on an already-issued pass - relevantDate was present before the change, is present
 * after it, or both (covering it appearing, disappearing, or staying present with different
 * content). Checking only the post-write state would miss the "disappearing" case (e.g. clearing
 * event_hours_start while relevantDate was previously being sent) and would over-warn for an
 * event with no start time and no relevantDate on either side of the write - the exact false
 * positive this whole gate exists to remove (bot review): unlike every other
 * WALLET_RELEVANT_EVENT_FIELDS entry, these three aren't gated on fieldMapping at all, so a static
 * table entry can't express them; callers OR this in for those three fields specifically instead
 * of looking them up in {@link EVENT_FIELD_PLACEHOLDERS}.
 */
export function isRelevantDateAffected(before: RelevantDateState, after: RelevantDateState): boolean {
  const presentBefore = before.walletAppleEnabled && !!before.eventHoursStart;
  const presentAfter = after.walletAppleEnabled && !!after.eventHoursStart;
  return presentBefore || presentAfter;
}
