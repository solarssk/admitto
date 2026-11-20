-- The identity provider of an event's company sign-in (v0.8). Until now one provider, chosen by a superadmin, served every event
-- (SystemSettings "registration_sso_provider_id"); from now on each event that uses the company sign-in names its own. Additive
-- only: one nullable column, an index, a foreign key and a CHECK on "EventRegistrationSettings". The old SystemSettings key is
-- left where it is (nothing reads it after the code that follows this change).

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "sso_provider_id" TEXT;

-- CreateIndex
CREATE INDEX "EventRegistrationSettings_sso_provider_id_idx" ON "EventRegistrationSettings"("sso_provider_id");

-- AddForeignKey: deleting a provider closes the forms that used it (no provider chosen) and deletes nothing else.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_sso_provider_id_fkey"
  FOREIGN KEY ("sso_provider_id") REFERENCES "IdentityProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every event that has the company sign-in as its way in takes the provider that was chosen for the instance. The stored
-- value is the JSON string of an id; a row that does not read as one (not JSON, a number, an empty string), and an id that is no
-- OIDC provider, are skipped, which leaves the form closed exactly as the old code did.
UPDATE "EventRegistrationSettings" AS settings
SET "sso_provider_id" = provider."id"
FROM "SystemSettings" AS chosen
JOIN "IdentityProvider" AS provider
  ON chosen."value_json" ~ '^"[^"\\]+"$' AND provider."id" = substring(chosen."value_json" FROM 2 FOR char_length(chosen."value_json") - 2)
WHERE chosen."key" = 'registration_sso_provider_id'
  AND provider."provider_type" = 'oidc'
  AND 'sso' = ANY(settings."access_methods");

-- A provider belongs to the company sign-in: no row keeps one while its way in is another.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_sso_provider_check"
  CHECK ("sso_provider_id" IS NULL OR 'sso' = ANY("access_methods"));
