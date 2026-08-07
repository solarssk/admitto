-- WebAuthn credential columns on UserMfaMethod (one row per registered passkey/security key,
-- type = "webauthn"). Nullable defaults keep existing TOTP/recovery rows untouched, except
-- webauthn_transports: the Prisma model declares it a non-optional String[], so it needs its own
-- NOT NULL DEFAULT '{}' (matching the ARRAY[]::TEXT[] convention Prisma itself generates for
-- every other required scalar-list column in this schema, e.g. ExternalIdentity.groups) rather
-- than leaving existing rows with a raw SQL NULL the declared type can never actually hold.
ALTER TABLE "UserMfaMethod" ADD COLUMN     "webauthn_aaguid" TEXT,
ADD COLUMN     "webauthn_attachment" TEXT,
ADD COLUMN     "webauthn_credential_id" TEXT,
ADD COLUMN     "webauthn_public_key" BYTEA,
ADD COLUMN     "webauthn_sign_count" INTEGER,
ADD COLUMN     "webauthn_transports" TEXT[] NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE UNIQUE INDEX "UserMfaMethod_webauthn_credential_id_key" ON "UserMfaMethod"("webauthn_credential_id");
