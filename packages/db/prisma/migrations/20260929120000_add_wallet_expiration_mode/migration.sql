-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "wallet_expiration_mode" TEXT NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "WalletPass" ADD COLUMN     "expires_at" TIMESTAMP(3);

-- Candidate index for the local wallet-expiry worker job: an active or voided pass with a
-- canonical expires_at in the past, not yet removed at the provider - the job never contacts the
-- provider, so no provider-related predicate is needed here (unlike
-- WalletPass_registration_sync_pending_idx, which the sync job's own provider-facing candidate
-- query needs).
CREATE INDEX "WalletPass_expires_at_pending_idx"
  ON "WalletPass" ("expires_at" ASC)
  WHERE "status" IN ('active', 'voided') AND "expires_at" IS NOT NULL;
