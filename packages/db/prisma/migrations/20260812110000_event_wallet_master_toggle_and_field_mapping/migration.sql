-- Additive (ADR 0041): wallet_enabled is the card-header master switch (mirrors Weather/Maps'
-- enable toggle) - turning it off hides both wallet buttons on tickets without touching the
-- per-platform Apple/Google switches or clearing the key/template. wallet_field_mapping lets an
-- admin remap PassCreator field keys to Admitto placeholder tokens instead of the hardcoded
-- 5-field default (name, eventDate, eventHours, eventPlace, ticketType); null/empty keeps that
-- default.
ALTER TABLE "Event"
  ADD COLUMN "wallet_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "wallet_field_mapping" JSONB;
