-- Guest registration schema (v0.8). Additive only: three new tables, no change to an existing one.
-- Nothing writes these tables yet; with no EventRegistrationSettings row, registration is off.

-- CreateTable
CREATE TABLE "EventRegistrationSettings" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "mode" TEXT,
    "access_methods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "password_hash" TEXT,
    "waitlist_enabled" BOOLEAN NOT NULL DEFAULT true,
    "verify_email" BOOLEAN NOT NULL DEFAULT true,
    "max_companions" INTEGER NOT NULL DEFAULT 0,
    "ask_company" BOOLEAN NOT NULL DEFAULT false,
    "ask_department" BOOLEAN NOT NULL DEFAULT false,
    "consent_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistrationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "department" TEXT,
    "custom_data" JSONB,
    "companions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "confirm_expires_at" TIMESTAMP(3),
    "email_verified_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,
    "locale" TEXT,
    "accepted_at" TIMESTAMP(3),
    "consents" JSONB NOT NULL DEFAULT '{}',
    "attendee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationMail" (
    "id" TEXT NOT NULL,
    "registration_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "template_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryable" BOOLEAN,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempted_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "error_code" TEXT,
    "error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationMail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationSettings_event_id_key" ON "EventRegistrationSettings"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_attendee_id_event_id_key" ON "Registration"("attendee_id", "event_id");

-- CreateIndex
CREATE INDEX "Registration_event_id_status_created_at_id_idx" ON "Registration"("event_id", "status", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_event_id_email_key" ON "Registration"("event_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_id_event_id_key" ON "Registration"("id", "event_id");

-- CreateIndex
CREATE INDEX "RegistrationMail_event_id_queued_at_idx" ON "RegistrationMail"("event_id", "queued_at");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationMail_registration_id_template_name_key" ON "RegistrationMail"("registration_id", "template_name");

-- AddForeignKey
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_attendee_id_event_id_fkey" FOREIGN KEY ("attendee_id", "event_id") REFERENCES "Attendee"("id", "event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationMail" ADD CONSTRAINT "RegistrationMail_registration_id_event_id_fkey" FOREIGN KEY ("registration_id", "event_id") REFERENCES "Registration"("id", "event_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationMail" ADD CONSTRAINT "RegistrationMail_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EventRegistrationSettings: the values the application writes are closed sets, so the database
-- refuses anything else (a raw write, a script, a later migration). mode null = registration off.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_mode_check"
  CHECK ("mode" IS NULL OR "mode" IN ('automatic', 'approval'));

-- A list on purpose (D-C1): the database does not limit it to one method.
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_access_methods_check"
  CHECK ("access_methods" IS NOT NULL AND "access_methods" <@ ARRAY['link', 'password', 'sso']::TEXT[]);

-- Prisma declares a scalar list without NOT NULL; a NULL list would read as "no consents asked".
ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_consent_keys_not_null"
  CHECK ("consent_keys" IS NOT NULL);

ALTER TABLE "EventRegistrationSettings" ADD CONSTRAINT "EventRegistrationSettings_max_companions_check"
  CHECK ("max_companions" >= 0);

-- Registration.status is TEXT plus a CHECK, like every status column (20260626220000_status_check_constraints).
-- Values: packages/db/src/status.ts (REGISTRATION_STATUS).
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_status_check"
  CHECK ("status" IN ('awaiting_email', 'pending', 'waitlist', 'accepted', 'rejected'));

-- One address, one spelling: the unique index on (event_id, email) is case sensitive, so the
-- application writes lower(btrim(email)) and the database refuses anything else.
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_email_normalized"
  CHECK ("email" = lower(btrim("email")));

-- The namespace of the erased-attendee placeholders is reserved (docs/dev/attendee-erasure.md):
-- a registration with such an address would later fail to become an attendee. The table is new,
-- so there is nothing to repair first.
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_email_not_erased_placeholder"
  CHECK (lower("email") NOT LIKE '%@erased.invalid');

-- A registration is linked to an attendee exactly when it was accepted.
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_accepted_iff_attendee"
  CHECK (("status" = 'accepted') = ("attendee_id" IS NOT NULL));

-- Only a registration that still waits for the address to be confirmed has an expiry.
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_awaiting_email_iff_expiry"
  CHECK (("status" = 'awaiting_email') = ("confirm_expires_at" IS NOT NULL));

ALTER TABLE "Registration" ADD CONSTRAINT "Registration_companions_is_array"
  CHECK (jsonb_typeof("companions") = 'array');

ALTER TABLE "Registration" ADD CONSTRAINT "Registration_consents_is_object"
  CHECK (jsonb_typeof("consents") = 'object');

-- The worker's clean-up of registrations that were never confirmed reads only these rows.
CREATE INDEX "Registration_awaiting_email_expiry_idx" ON "Registration"("confirm_expires_at")
  WHERE "status" = 'awaiting_email';

-- RegistrationMail: the status vocabulary of EmailDelivery, and the five mails of D-D1.
ALTER TABLE "RegistrationMail" ADD CONSTRAINT "RegistrationMail_status_check"
  CHECK ("status" IN ('queued', 'accepted', 'sent', 'delivered', 'failed', 'bounced', 'rejected', 'cancelled'));

ALTER TABLE "RegistrationMail" ADD CONSTRAINT "RegistrationMail_template_name_check"
  CHECK ("template_name" IN (
    'registration-confirm', 'registration-received', 'registration-waitlist', 'registration-rejected', 'ticket'
  ));

-- The worker reads rows that are waiting or can be retried.
CREATE INDEX "RegistrationMail_pending_idx" ON "RegistrationMail"("queued_at")
  WHERE "status" IN ('queued', 'failed');

-- Wake the worker when a registration mail is queued, as for AdminJob and EmailDelivery
-- (20260813170000_worker_wake_notify_trigger, same shared function and channel). A retry or a
-- resend resets the existing row to 'queued' with an UPDATE, so both INSERT and UPDATE OF status fire.
CREATE TRIGGER admitto_registration_mail_wake
  AFTER INSERT OR UPDATE OF status ON "RegistrationMail"
  FOR EACH ROW
  WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION admitto_notify_worker_wake();
