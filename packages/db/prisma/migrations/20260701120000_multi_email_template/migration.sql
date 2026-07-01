-- Multiple email templates per scope (v0.4.9): name + label, new unique key, EmailDelivery FK.

ALTER TABLE "MailTemplate"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'ticket',
  ADD COLUMN "label" TEXT NOT NULL DEFAULT 'Ticket email';

UPDATE "MailTemplate"
SET "name" = 'ticket', "label" = 'Ticket email'
WHERE "name" IS NULL OR "name" = '';

DROP INDEX "MailTemplate_scope_type_scope_id_key";

CREATE UNIQUE INDEX "MailTemplate_scope_type_scope_id_name_key"
  ON "MailTemplate" ("scope_type", "scope_id", "name");

UPDATE "EmailDelivery"
SET "template_id" = NULL
WHERE "template_id" IS NOT NULL
  AND "template_id" NOT IN (SELECT "id" FROM "MailTemplate");

ALTER TABLE "EmailDelivery"
  ADD CONSTRAINT "EmailDelivery_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "MailTemplate"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
