-- AlterTable
ALTER TABLE "Event" ADD COLUMN "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Event_organization_id_archived_at_idx" ON "Event"("organization_id", "archived_at");
