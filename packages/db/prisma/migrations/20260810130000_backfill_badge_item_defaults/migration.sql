-- Keep existing operator customizations while giving legacy default badges the current
-- description and icon used by new events.
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
  AND (
    "description" IS NULL
    OR "icon" IS NULL
    OR "icon" = 'package'
  );
