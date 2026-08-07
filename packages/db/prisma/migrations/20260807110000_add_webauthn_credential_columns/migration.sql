-- WebAuthn credential columns on UserMfaMethod (one row per registered passkey/security key,
-- type = "webauthn"). Nullable/empty-array defaults keep existing TOTP/recovery rows untouched.
ALTER TABLE "UserMfaMethod" ADD COLUMN     "webauthn_aaguid" TEXT,
ADD COLUMN     "webauthn_attachment" TEXT,
ADD COLUMN     "webauthn_credential_id" TEXT,
ADD COLUMN     "webauthn_public_key" BYTEA,
ADD COLUMN     "webauthn_sign_count" INTEGER,
ADD COLUMN     "webauthn_transports" TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "UserMfaMethod_webauthn_credential_id_key" ON "UserMfaMethod"("webauthn_credential_id");
