-- Format rules of an attendee field (v0.8): minimum and maximum length, digits only, an example. Additive only: one
-- nullable column on "EventCustomField". NULL means no rules, which is what every existing field has, so nothing
-- changes for a reader that does not know the column.

-- AlterTable
ALTER TABLE "EventCustomField" ADD COLUMN     "rules" JSONB;

-- rules is NULL or a JSON object. Which keys it may hold, and which field types take them, is checked in the
-- application (a strict Zod object), so a later rule needs no migration. A JSON null is refused on purpose: no rules
-- is the SQL NULL.
ALTER TABLE "EventCustomField" ADD CONSTRAINT "EventCustomField_rules_is_object"
  CHECK ("rules" IS NULL OR jsonb_typeof("rules") = 'object');
