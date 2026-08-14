-- Additive (ADR 0027): per-event PassCreator template ID (org-level API key lives in SystemSettings).
ALTER TABLE "Event" ADD COLUMN "wallet_template_id" TEXT;
