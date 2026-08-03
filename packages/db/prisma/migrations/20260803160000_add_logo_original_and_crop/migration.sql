-- Persist uncropped logo + last crop framing so Edit works after Save/reload.
ALTER TABLE "Organization" ADD COLUMN "logo_original_url" TEXT;
ALTER TABLE "Organization" ADD COLUMN "logo_crop" JSONB;

ALTER TABLE "Event" ADD COLUMN "logo_original_url" TEXT;
ALTER TABLE "Event" ADD COLUMN "logo_crop" JSONB;
