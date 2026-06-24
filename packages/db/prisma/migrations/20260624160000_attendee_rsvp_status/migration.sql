-- Attendee RSVP status fields (ADR 0033).
ALTER TABLE "Attendee"
  ADD COLUMN "rsvp_status" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "rsvp_updated_at" TIMESTAMP(3),
  ADD COLUMN "rsvp_source" TEXT;
