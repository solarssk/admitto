-- Guest sign-in with the company's identity provider (v0.8, D-C4). Additive only: two nullable columns and a unique index on
-- "Registration", two columns on "EventRegistrationSettings" and one new table. Nothing is changed or removed, so every
-- reader and writer that does not know them keeps working, and every row that exists keeps its meaning (a registration
-- without a sign-in has NULL in both columns; an event has no restriction).

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "sso_provider_id" TEXT,
ADD COLUMN     "sso_subject" TEXT;

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "sso_claim_name" TEXT,
ADD COLUMN     "sso_claim_values" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "RegistrationSsoState" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationSsoState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationSsoState_state_key" ON "RegistrationSsoState"("state");

-- CreateIndex
CREATE INDEX "RegistrationSsoState_expires_at_idx" ON "RegistrationSsoState"("expires_at");

-- CreateIndex
CREATE INDEX "RegistrationSsoState_event_id_idx" ON "RegistrationSsoState"("event_id");

-- CreateIndex
CREATE INDEX "RegistrationSsoState_provider_id_idx" ON "RegistrationSsoState"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_event_id_sso_provider_id_sso_subject_key" ON "Registration"("event_id", "sso_provider_id", "sso_subject");

-- AddForeignKey
ALTER TABLE "RegistrationSsoState" ADD CONSTRAINT "RegistrationSsoState_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationSsoState" ADD CONSTRAINT "RegistrationSsoState_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "IdentityProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The provider and the person are one fact: both or neither. The id a provider gives a person (`sub`) is at most 255 ASCII
-- characters (OIDC Core 2), and is never empty.
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_sso_pair_check"
  CHECK (("sso_provider_id" IS NULL) = ("sso_subject" IS NULL));
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_sso_subject_length_check"
  CHECK ("sso_subject" IS NULL OR char_length("sso_subject") BETWEEN 1 AND 255);

-- The restriction of an event to one claim: the name and the allowed values are set together or not at all. NULL is read as
-- "no values" (an event that existed before this column).
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_sso_claim_pair_check"
  CHECK (("sso_claim_name" IS NULL) = (COALESCE(cardinality("sso_claim_values"), 0) = 0));
