-- Additive: optimistic locking for admin attendee edits (ADR 0028).
ALTER TABLE "Attendee" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
