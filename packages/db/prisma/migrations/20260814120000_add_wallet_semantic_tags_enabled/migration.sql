-- Apple Wallet semantic tags (Siri Suggestions/Maps/Calendar) - opt-in per event, default off
-- (ADR 0009 data minimization). Apple only, no NFC/poster-style, no Google Wallet equivalent.
ALTER TABLE "Event" ADD COLUMN "wallet_semantic_tags_enabled" BOOLEAN NOT NULL DEFAULT false;
