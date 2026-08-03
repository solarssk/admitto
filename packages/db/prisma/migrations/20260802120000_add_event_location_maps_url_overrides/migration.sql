-- Manual Google / Apple Maps deep-link overrides when the coordinate-built URL opens the wrong place.
ALTER TABLE "EventLocation" ADD COLUMN "google_maps_url_override" TEXT;
ALTER TABLE "EventLocation" ADD COLUMN "apple_maps_url_override" TEXT;
