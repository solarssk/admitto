-- EmailDelivery extended for ADR 0007 (mail delivery status & tracking).

-- 1. Add event_id (nullable first for backfill).
ALTER TABLE "EmailDelivery" ADD COLUMN "event_id" TEXT;

-- 2. Backfill event_id from attendee.
UPDATE "EmailDelivery" ed
SET "event_id" = a."event_id"
FROM "Attendee" a
WHERE ed."attendee_id" = a."id" AND ed."event_id" IS NULL;

-- Greenfield: if no rows, set a placeholder only when table empty — otherwise NOT NULL below fails on orphans.
-- Orphan rows (no attendee) are deleted — should not exist on greenfield.
DELETE FROM "EmailDelivery" WHERE "event_id" IS NULL;

ALTER TABLE "EmailDelivery" ALTER COLUMN "event_id" SET NOT NULL;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. New columns
ALTER TABLE "EmailDelivery" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE "EmailDelivery" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "template_id" TEXT;
ALTER TABLE "EmailDelivery" RENAME COLUMN "message_id" TO "provider_message_id";
ALTER TABLE "EmailDelivery" ADD COLUMN "error_code" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "error" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "retryable" BOOLEAN;
ALTER TABLE "EmailDelivery" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EmailDelivery" ADD COLUMN "recipient_email" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "rendered_subject" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "rendered_html" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "EmailDelivery" ADD COLUMN "attempted_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "accepted_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "failed_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "viewed_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "opened_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "clicked_at" TIMESTAMP(3);
ALTER TABLE "EmailDelivery" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Migrate legacy status values
UPDATE "EmailDelivery" SET "status" = 'sent' WHERE "status" = 'pending' AND "sent_at" IS NOT NULL;
UPDATE "EmailDelivery" SET "status" = 'queued' WHERE "status" = 'pending';

-- 5. Indexes
CREATE INDEX "EmailDelivery_event_id_created_at_idx" ON "EmailDelivery"("event_id", "created_at" DESC);
CREATE INDEX "EmailDelivery_attendee_id_event_id_status_idx" ON "EmailDelivery"("attendee_id", "event_id", "status");

-- 6. Atomic dedup for initial sends (partial unique index)
CREATE UNIQUE INDEX "EmailDelivery_initial_unique"
  ON "EmailDelivery" ("attendee_id", "event_id")
  WHERE purpose = 'initial';
