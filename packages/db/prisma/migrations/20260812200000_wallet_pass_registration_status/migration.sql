-- Registration status as PassCreator itself reports it (GET /api/v3/pass?userProvidedId=...),
-- refreshed periodically by the wallet-sync worker job. All nullable/additive - no backfill,
-- existing rows simply read as "never checked" until the worker's next tick reaches them.
ALTER TABLE "WalletPass" ADD COLUMN "apple_active_registrations" INTEGER;
ALTER TABLE "WalletPass" ADD COLUMN "apple_inactive_registrations" INTEGER;
ALTER TABLE "WalletPass" ADD COLUMN "google_active_registrations" INTEGER;
ALTER TABLE "WalletPass" ADD COLUMN "google_inactive_registrations" INTEGER;
-- Text, not TIMESTAMP: PassCreator's docs don't state which timezone this string is in (no UTC
-- offset/Z in any example) - stored and displayed verbatim rather than parsed, so we never assert
-- a timezone we don't actually know.
ALTER TABLE "WalletPass" ADD COLUMN "first_downloaded_at" TEXT;
ALTER TABLE "WalletPass" ADD COLUMN "registration_checked_at" TIMESTAMP(3);
