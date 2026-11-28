-- Attendee fields on the guest registration form (v0.8). Additive only: two columns on "EventCustomField", both
-- safe for every reader that does not know them. "show_on_form" is false for each existing field, so the form asks
-- nothing until an organiser opts a field in. "display_order" is the position of a field among its event's fields;
-- null means "not placed yet" and sorts after every placed field.

-- AlterTable
ALTER TABLE "EventCustomField" ADD COLUMN     "display_order" INTEGER,
ADD COLUMN     "show_on_form" BOOLEAN NOT NULL DEFAULT false;

-- Number the fields that exist today 0, 1, 2... within each event, in the order every reader showed them until now
-- (oldest first, ties by id), so the new sort rule changes nothing on screen. Only a field with no position yet is
-- numbered: applying this again never moves a field that was placed.
UPDATE "EventCustomField" AS field
SET "display_order" = ranked."position"
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "event_id" ORDER BY "created_at", "id") - 1)::INTEGER AS "position"
  FROM "EventCustomField"
) AS ranked
WHERE field."id" = ranked."id" AND field."display_order" IS NULL;
