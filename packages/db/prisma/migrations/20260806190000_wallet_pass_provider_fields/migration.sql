-- Expand-contract (ADR 0027): additive only, nothing dropped. On-demand wallet passes (ADR 0009,
-- ADR 0041) need provider identity, delivery URLs, and richer status before a pass exists.
ALTER TABLE "WalletPass"
  ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'passcreator',
  ADD COLUMN "provider_pass_id" TEXT,
  ADD COLUMN "user_provided_id" TEXT,
  ADD COLUMN "download_url" TEXT,
  ADD COLUMN "apple_url" TEXT,
  ADD COLUMN "android_url" TEXT,
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "last_synced_at" TIMESTAMP(3),
  ADD COLUMN "issued_at" TIMESTAMP(3),
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ALTER COLUMN "pass_type_id" DROP NOT NULL,
  ALTER COLUMN "serial_number" DROP NOT NULL,
  ALTER COLUMN "auth_token" DROP NOT NULL;

-- NULL provider_pass_id/user_provided_id are distinct in Postgres, so multiple "pending" rows
-- (not yet created with the provider) coexist without colliding.
CREATE UNIQUE INDEX "WalletPass_provider_provider_pass_id_key" ON "WalletPass"("provider", "provider_pass_id");
CREATE UNIQUE INDEX "WalletPass_provider_user_provided_id_key" ON "WalletPass"("provider", "user_provided_id");
