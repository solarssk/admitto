-- 2FA/TOTP foundation (v0.3.3 prompt 16a): MFA methods, trusted devices, session stage, SystemSettings.

-- Session.stage for pending-2FA / forced enrollment
ALTER TABLE "Session" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'full';

ALTER TABLE "Session" ADD CONSTRAINT "Session_stage_check"
    CHECK ("stage" IN ('full', 'mfa_pending', 'enrollment_required'));

-- CreateTable UserMfaMethod
CREATE TABLE "UserMfaMethod" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "secret_enc" TEXT,
    "credential_hash" TEXT,
    "label" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMfaMethod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserMfaMethod" ADD CONSTRAINT "UserMfaMethod_type_check"
    CHECK ("type" IN ('totp', 'webauthn', 'recovery'));

-- At most one TOTP row per user
CREATE UNIQUE INDEX "UserMfaMethod_user_totp_key" ON "UserMfaMethod"("user_id")
    WHERE "type" = 'totp';

CREATE INDEX "UserMfaMethod_user_id_type_idx" ON "UserMfaMethod"("user_id", "type");

ALTER TABLE "UserMfaMethod" ADD CONSTRAINT "UserMfaMethod_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable TrustedDevice
CREATE TABLE "TrustedDevice" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "TrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrustedDevice_token_hash_key" ON "TrustedDevice"("token_hash");
CREATE INDEX "TrustedDevice_user_id_idx" ON "TrustedDevice"("user_id");
CREATE INDEX "TrustedDevice_expires_at_idx" ON "TrustedDevice"("expires_at");

ALTER TABLE "TrustedDevice" ADD CONSTRAINT "TrustedDevice_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable SystemSettings
CREATE TABLE "SystemSettings" (
    "key" TEXT NOT NULL,
    "value_json" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("key")
);

-- Seed defaults (prompt 16a §7) — ms for TTL keys
INSERT INTO "SystemSettings" ("key", "value_json", "updated_at") VALUES
    ('session_ttl', '604800000', NOW()),
    ('operator_session_ttl', '43200000', NOW()),
    ('trusted_device_days', '30', NOW()),
    ('mfa_required_roles', '["admin","superadmin"]', NOW());

-- Re-stage active elevated sessions so MFA applies immediately on rollout (not after TTL expiry).
-- Operator-only sessions stay `full`; admin/superadmin get mfa_pending or enrollment_required.
UPDATE "Session" s
SET "stage" = CASE
    WHEN EXISTS (
        SELECT 1 FROM "UserMfaMethod" m
        WHERE m."user_id" = s."user_id"
          AND m."type" = 'totp'
          AND m."confirmed_at" IS NOT NULL
    ) THEN 'mfa_pending'
    ELSE 'enrollment_required'
END,
    "expires_at" = LEAST(s."expires_at", NOW() + INTERVAL '15 minutes')
WHERE s."revoked_at" IS NULL
  AND s."expires_at" > NOW()
  AND EXISTS (
      SELECT 1 FROM "RoleAssignment" ra
      WHERE ra."user_id" = s."user_id"
        AND ra."role" IN ('admin', 'superadmin')
  );
