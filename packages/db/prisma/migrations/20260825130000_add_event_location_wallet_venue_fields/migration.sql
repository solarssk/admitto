-- Venue-specific data exposed as new Wallet field-mapping placeholders (WALLET_MAPPING_PLACEHOLDERS)
-- for PassCreator's Apple Wallet Semantic Tags vocabulary. All optional.
ALTER TABLE "EventLocation"
  ADD COLUMN "venue_room" TEXT,
  ADD COLUMN "venue_entrance" TEXT,
  ADD COLUMN "venue_entrance_door" TEXT,
  ADD COLUMN "venue_entrance_gate" TEXT,
  ADD COLUMN "venue_entrance_portal" TEXT,
  ADD COLUMN "venue_phone_number" TEXT,
  ADD COLUMN "venue_place_id" TEXT,
  ADD COLUMN "venue_open_time" TEXT,
  ADD COLUMN "venue_close_time" TEXT,
  ADD COLUMN "doors_open_time" TEXT,
  ADD COLUMN "gates_open_time" TEXT,
  ADD COLUMN "box_office_open_time" TEXT,
  ADD COLUMN "parking_lots_open_time" TEXT,
  ADD COLUMN "fan_zone_open_time" TEXT;

-- Defense-in-depth, mirrors 20260731201533_add_event_location's pattern for short text fields.
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_room_length" CHECK (char_length("venue_room") <= 300);
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_entrance_length" CHECK (char_length("venue_entrance") <= 300);
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_entrance_door_length" CHECK (char_length("venue_entrance_door") <= 300);
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_entrance_gate_length" CHECK (char_length("venue_entrance_gate") <= 300);
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_entrance_portal_length" CHECK (char_length("venue_entrance_portal") <= 300);
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_phone_number_length" CHECK (char_length("venue_phone_number") <= 300);
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_venue_place_id_length" CHECK (char_length("venue_place_id") <= 300);
