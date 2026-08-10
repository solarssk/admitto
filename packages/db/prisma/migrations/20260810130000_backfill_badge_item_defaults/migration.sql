-- Backfill Badge defaults only where we can positively identify uncustomized rows.
--
-- Empty description and null/"package" icon are NOT safe markers on their own:
-- EventItemDrawer persists a cleared description as NULL, and
-- normalizeEventItemIconForStorage stores both the package default and "no icon"
-- as NULL. Updating every matching badge would destroy intentional operator
-- choices and cannot be reversed after migrate.
--
-- Untouched seed rows (from 20260617120000) use the deterministic id
-- ei_||md5(event_id||':badge') and still have updated_at = created_at.
UPDATE "EventItem"
SET
  "description" = CASE
    WHEN "description" IS NULL THEN 'Name badge issued at check-in.'
    ELSE "description"
  END,
  "icon" = CASE
    WHEN "icon" IS NULL OR "icon" = 'package' THEN 'id-badge-2'
    ELSE "icon"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'badge'
  AND "id" = ('ei_' || substr(md5("event_id" || ':badge'), 1, 24))
  AND "updated_at" = "created_at"
  AND (
    "description" IS NULL
    OR "icon" IS NULL
    OR "icon" = 'package'
  );

-- Literal icon 'package' is never the intentional post-normalize stored value
-- (package collapses to NULL on save), so rewriting only the icon is always safe.
UPDATE "EventItem"
SET
  "icon" = 'id-badge-2',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'badge'
  AND "icon" = 'package';
