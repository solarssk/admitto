-- AlterTable
ALTER TABLE "Attendee" ADD COLUMN "public_ref" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_public_ref_key" ON "Attendee"("public_ref");
