-- AlterTable
ALTER TABLE "WalletPass" ADD COLUMN     "provider_removed_at" TIMESTAMP(3),
ADD COLUMN     "provider_commanded_at" TIMESTAMP(3);

-- Rebuild the wallet-sync worker's partial index (added in
-- 20260813180000_add_wallet_pass_registration_sync_pending_idx) with the same predicate plus
-- provider_removed_at IS NULL: a row whose remote pass Admitto has removed is never a sync
-- candidate, and registration-sync.ts's candidate query now carries the same condition. Postgres
-- only uses a partial index for a query whose WHERE implies the index predicate, so the query and
-- this predicate have to change together.
DROP INDEX IF EXISTS "WalletPass_registration_sync_pending_idx";
CREATE INDEX "WalletPass_registration_sync_pending_idx"
  ON "WalletPass" ("registration_sync_attempted_at" ASC NULLS FIRST)
  WHERE "status" IN ('active', 'voided') AND "provider_pass_id" IS NOT NULL AND "user_provided_id" IS NOT NULL AND "provider_removed_at" IS NULL;
