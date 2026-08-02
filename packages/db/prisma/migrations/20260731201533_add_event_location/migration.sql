-- CreateTable
CREATE TABLE "EventLocation" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "formatted_address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "map_zoom" INTEGER NOT NULL DEFAULT 15,
    "directions_text" TEXT,
    "accessibility_text" TEXT,
    "geocoding_provider" TEXT,
    "geocoded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventLocation_event_id_key" ON "EventLocation"("event_id");

-- AddForeignKey
ALTER TABLE "EventLocation" ADD CONSTRAINT "EventLocation_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense-in-depth: match @admitto/location's LOCATION_LIMITS (validation.ts).
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_formatted_address_length" CHECK (char_length("formatted_address") <= 500);
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_directions_text_length" CHECK (char_length("directions_text") <= 2000);
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_accessibility_text_length" CHECK (char_length("accessibility_text") <= 2000);
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_latitude_range" CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90));
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_longitude_range" CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180));
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_map_zoom_range" CHECK ("map_zoom" >= 1 AND "map_zoom" <= 19);
-- Both coordinates set, or neither - mirrors assertCoordinatePairing in @admitto/location.
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_coordinate_pairing" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
