-- Speeds up the wallet-sync worker's candidate-selection query (registration-sync.ts):
--   WHERE status IN ('active','voided') AND provider_pass_id IS NOT NULL
--     AND user_provided_id IS NOT NULL
--     AND (registration_sync_attempted_at IS NULL OR registration_sync_attempted_at < ?)
--   ORDER BY registration_sync_attempted_at ASC NULLS FIRST LIMIT 25
-- Without this, every tick scans all active/voided WalletPass rows to find the oldest-attempted
-- ones instead of reading the already-sorted head of a small partial index.
CREATE INDEX "WalletPass_registration_sync_pending_idx"
  ON "WalletPass" ("registration_sync_attempted_at" ASC NULLS FIRST)
  WHERE "status" IN ('active', 'voided') AND "provider_pass_id" IS NOT NULL AND "user_provided_id" IS NOT NULL;
