-- The companion (+1) of an attendee (v0.8). Additive only: one new table and one column with a default on an existing
-- table, both safe for every reader and writer that does not know them. Nothing writes the table yet but the admission
-- of a registration that holds a companion, and no registration does until the form asks for one.

-- AlterTable
-- Whose answer a question asks for. Every field that exists today is a question about the guest, which is what the
-- default says, so no row needs to be touched (a constant default is stored in the catalog, not written to the rows).
ALTER TABLE "EventCustomField" ADD COLUMN     "applies_to" TEXT NOT NULL DEFAULT 'guest';

-- CreateTable
CREATE TABLE "AttendeeCompanion" (
    "id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "custom_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendeeCompanion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendeeCompanion_attendee_id_slot_key" ON "AttendeeCompanion"("attendee_id", "slot");

-- AddForeignKey
-- Cascade: removing an attendee from an event deletes the companions with them. Erasing an attendee keeps the rows
-- (the seat of an admitted guest stays counted) and the application empties them.
ALTER TABLE "AttendeeCompanion" ADD CONSTRAINT "AttendeeCompanion_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EventCustomField.applies_to is TEXT plus a CHECK, like every closed set of values (20260626220000_status_check_constraints).
-- Values: packages/db/src/status.ts (CUSTOM_FIELD_APPLIES_TO).
ALTER TABLE "EventCustomField" ADD CONSTRAINT "EventCustomField_applies_to_check"
  CHECK ("applies_to" IN ('guest', 'companion'));

-- A slot is a position, counted from 1. How many slots an attendee may use is a rule of the application
-- (MAX_COMPANION_SLOTS in @admitto/tickets), so a later release can raise it without a migration (D-E5).
ALTER TABLE "AttendeeCompanion" ADD CONSTRAINT "AttendeeCompanion_slot_check"
  CHECK ("slot" >= 1);

-- The answers are SQL NULL (none, or erased) or a JSON object of key to text. A JSON null, an array or a string is
-- refused on purpose: Prisma.DbNull is the way to write none, and the erasure writes it.
ALTER TABLE "AttendeeCompanion" ADD CONSTRAINT "AttendeeCompanion_custom_data_is_object"
  CHECK ("custom_data" IS NULL OR jsonb_typeof("custom_data") = 'object');
