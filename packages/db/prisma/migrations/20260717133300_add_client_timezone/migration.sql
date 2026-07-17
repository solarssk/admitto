-- Captures the acting browser's IANA timezone at write time, so the admin UI can display each
-- row in the timezone that was actually relevant when it happened, instead of a single global
-- rule (event timezone or UTC) applied to everything regardless of who wrote it or from where.
-- Nullable, no default: existing rows and any future non-browser write path fall back to
-- event timezone at display time.
ALTER TABLE "AttendeeActionLog" ADD COLUMN "client_timezone" TEXT;
ALTER TABLE "EmailDelivery" ADD COLUMN "client_timezone" TEXT;
ALTER TABLE "Attendee" ADD COLUMN "client_timezone" TEXT;
