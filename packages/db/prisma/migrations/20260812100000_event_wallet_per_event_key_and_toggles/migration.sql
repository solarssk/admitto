-- Additive (ADR 0041): the PassCreator API key moves from org-level SystemSettings to a
-- per-event column, alongside the existing wallet_template_id - each event's key can be rotated
-- or scoped independently. wallet_apple_enabled/wallet_google_enabled let an event turn off one
-- wallet platform without clearing the key/template shared by both.
ALTER TABLE "Event"
  ADD COLUMN "wallet_api_key_enc" TEXT,
  ADD COLUMN "wallet_apple_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "wallet_google_enabled" BOOLEAN NOT NULL DEFAULT true;
