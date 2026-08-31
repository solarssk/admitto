/** Event fields that appear in a wallet pass via WALLET_MAPPING_PLACEHOLDERS (event name, hours,
 * date, location, event type) - changing one of these on an event with already-issued wallet
 * passes triggers an automatic push to refresh them
 * (apps/web/src/admin/event-settings-routes.ts's pushWalletUpdatesBestEffort). wallet_apple_enabled
 * is included too: PassCreator's relevantDate (Lock Screen surfacing) is Apple-only, gated on it
 * alone, so turning Apple Wallet off must also refresh already-issued passes. Shared with the
 * admin UI so it can warn before a save that would trigger this cascade, without a second,
 * independently-maintained copy of the same list. */
export const WALLET_RELEVANT_EVENT_FIELDS = [
  "title",
  "date",
  "timezone",
  "event_hours_start",
  "event_hours_end",
  "event_type",
  "wallet_apple_enabled",
] as const;

/** Location fields that appear in a wallet pass via buildWalletPassInput (packages/tickets/src/
 * wallet-pass-input.ts) - venue name, address, coordinates/maps links, directions/accessibility
 * notes, entrance/gate/timing details. Changing one of these on an event with already-issued
 * wallet passes triggers an automatic push to refresh them
 * (apps/web/src/admin/event-location-routes.ts's pushWalletUpdatesBestEffort). `map_zoom` and
 * geocoding provenance (`geocoding_provider`/`geocoded_at`) are deliberately excluded - UI-only,
 * never read by the pass. Shared with the admin UI for the same reason as
 * WALLET_RELEVANT_EVENT_FIELDS above; the server's own event-location-routes.ts keeps a narrower
 * text-only subset of this same list for its own comparison logic (its doc comment explains why),
 * so this is the superset to check against, not a second copy of that subset. */
export const WALLET_RELEVANT_LOCATION_FIELDS = [
  "venue_name",
  "formatted_address",
  "latitude",
  "longitude",
  "directions_text",
  "accessibility_text",
  "address_components",
  "google_maps_url_override",
  "apple_maps_url_override",
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

/** Attendee fields that appear in a wallet pass via buildWalletPassInput (packages/tickets/src/
 * wallet-pass-input.ts) - changing one of these on an attendee with an already-issued active
 * wallet pass triggers an automatic push to refresh it
 * (apps/web/src/admin/attendees-api-routes.ts's pushWalletUpdateOnAttendeeChangeBestEffort).
 * Shared with the admin UI for the same reason as WALLET_RELEVANT_EVENT_FIELDS above. */
export const WALLET_RELEVANT_ATTENDEE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "company",
  "department",
  "ticket_type",
] as const;
