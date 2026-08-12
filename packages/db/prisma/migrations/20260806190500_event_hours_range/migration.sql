-- Additive (ADR 0027): display-only event hours range for tickets/wallet passes.
ALTER TABLE "Event"
  ADD COLUMN "event_hours_start" TEXT,
  ADD COLUMN "event_hours_end" TEXT;
