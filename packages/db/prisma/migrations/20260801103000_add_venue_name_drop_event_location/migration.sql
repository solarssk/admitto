-- Consolidates the venue's short display name into EventLocation.venue_name and removes the
-- now-duplicate Event.location text field (previously editable both in Basic Information and,
-- redundantly, nowhere else - the Location tab only ever wrote EventLocation). Backfill runs
-- inside this same migration transaction (not a separate post-migrate script, unlike other
-- backfills in this package) because the source column (Event.location) is dropped by the end of
-- this file - a script running after `prisma migrate deploy` would find nothing left to read.

-- 1. Add the new column first (nullable - not every event has a venue name yet).
ALTER TABLE "EventLocation" ADD COLUMN "venue_name" TEXT;

-- 2. Backfill: events that already have an EventLocation row (e.g. directions/coordinates set
--    via the Location tab) get their Event.location copied into venue_name alongside that data.
UPDATE "EventLocation" el
SET venue_name = e.location
FROM "Event" e
WHERE el.event_id = e.id
  AND e.location IS NOT NULL
  AND el.venue_name IS NULL;

-- 3. Backfill: events with a non-null Event.location but no EventLocation row yet get a minimal
--    row created so the venue name isn't silently lost. gen_random_uuid() (built into Postgres
--    13+, confirmed available here) stands in for Prisma's client-side cuid() - the id format
--    doesn't matter to Prisma, only uniqueness does.
INSERT INTO "EventLocation" ("id", "event_id", "venue_name", "map_zoom", "created_at", "updated_at")
SELECT gen_random_uuid()::text, e.id, e.location, 15, NOW(), NOW()
FROM "Event" e
LEFT JOIN "EventLocation" el ON el.event_id = e.id
WHERE el.event_id IS NULL
  AND e.location IS NOT NULL;

-- 4. Defense-in-depth length check, matching the old Event.location column (String? with a
--    300-char application-layer limit) and @admitto/location's LOCATION_LIMITS.
ALTER TABLE "EventLocation"
  ADD CONSTRAINT "EventLocation_venue_name_length" CHECK (char_length("venue_name") <= 300);

-- 5. Now safe to drop - every non-null value has been copied to EventLocation.venue_name above.
-- destructive-approved: Event.location replaced by EventLocation.venue_name after in-migration backfill (ADR 0027).
ALTER TABLE "Event" DROP COLUMN "location";
