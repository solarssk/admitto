import { describe, expect, it } from "vitest";
import {
  WALLET_RELEVANT_ATTENDEE_FIELDS,
  WALLET_RELEVANT_EVENT_FIELDS,
  WALLET_RELEVANT_LOCATION_FIELDS,
} from "../src/walletPushRelevantFields.js";

describe("WALLET_RELEVANT_EVENT_FIELDS", () => {
  it("lists exactly the fields that trigger an event-wide wallet push", () => {
    expect(WALLET_RELEVANT_EVENT_FIELDS).toEqual([
      "title",
      "date",
      "timezone",
      "event_hours_start",
      "event_hours_end",
      "event_type",
      "wallet_apple_enabled",
    ]);
  });
});

describe("WALLET_RELEVANT_LOCATION_FIELDS", () => {
  it("lists exactly the fields that trigger a location-save wallet push", () => {
    expect(WALLET_RELEVANT_LOCATION_FIELDS).toEqual([
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
    ]);
  });
});

describe("WALLET_RELEVANT_ATTENDEE_FIELDS", () => {
  it("lists exactly the fields that trigger a single-attendee wallet push", () => {
    expect(WALLET_RELEVANT_ATTENDEE_FIELDS).toEqual([
      "first_name",
      "last_name",
      "email",
      "company",
      "department",
      "ticket_type",
    ]);
  });
});
