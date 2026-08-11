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
-- Literal icon 'package' is never the intentional post-normalize stored value
-- (package collapses to NULL on save), so rewriting only that icon is always safe.
DO $$
DECLARE
  package_icon text := 'package';
  badge_icon text := 'id-badge-2';
  badge_description text := 'Name badge issued at check-in.';
BEGIN
  UPDATE "EventItem"
  SET
    "description" = CASE
      WHEN "description" IS NULL THEN badge_description
      ELSE "description"
    END,
    "icon" = CASE
      WHEN "icon" IS NULL OR "icon" = package_icon THEN badge_icon
      ELSE "icon"
    END,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "key" = 'badge'
    AND "id" = ('ei_' || substr(md5("event_id" || ':badge'), 1, 24))
    AND "updated_at" = "created_at"
    AND (
      "description" IS NULL
      OR "icon" IS NULL
      OR "icon" = package_icon
    );

  UPDATE "EventItem"
  SET
    "icon" = badge_icon,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "key" = 'badge'
    AND "icon" = package_icon;
END $$;
