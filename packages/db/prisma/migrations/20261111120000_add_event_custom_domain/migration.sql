-- The event's own address for guests (v0.8, D-C6). Additive only: four columns on "EventRegistrationSettings" and a unique index.
-- Nothing is changed or removed, so every reader and writer that does not know them keeps working, and every event that exists
-- keeps its meaning (no address: guests' links use the address of the instance, as before).

-- AlterTable
ALTER TABLE "EventRegistrationSettings" ADD COLUMN     "custom_domain" TEXT,
ADD COLUMN     "custom_domain_status" TEXT NOT NULL DEFAULT 'unchecked',
ADD COLUMN     "custom_domain_verified_at" TIMESTAMP(3),
ADD COLUMN     "custom_domain_checked_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationSettings_custom_domain_key" ON "EventRegistrationSettings"("custom_domain");

-- A bare host name in lower case and nothing else (the application checks much more; this keeps a value that carries a scheme, a
-- port, a path or an upper-case letter out of the table whatever writes it). At most 253 characters, as a name in DNS is.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_custom_domain_check"
  CHECK ("custom_domain" IS NULL OR ("custom_domain" = lower("custom_domain") AND char_length("custom_domain") BETWEEN 1 AND 253 AND "custom_domain" ~ '^[a-z0-9.-]+$'));

-- What the last check found: three words.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_custom_domain_status_check"
  CHECK ("custom_domain_status" IN ('unchecked', 'ok', 'failing'));

-- A verified address is an address: a row cannot keep the proof of one that was removed.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_custom_domain_verified_check"
  CHECK ("custom_domain_verified_at" IS NULL OR "custom_domain" IS NOT NULL);
