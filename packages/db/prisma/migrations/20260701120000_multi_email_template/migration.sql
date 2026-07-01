-- v0.4.9 multi-template: add name/label, new unique key, and drop legacy unique in one deploy step.

ALTER TABLE "MailTemplate"
  ADD COLUMN "name" TEXT NOT NULL DEFAULT 'ticket',
  ADD COLUMN "label" TEXT NOT NULL DEFAULT 'Ticket email';

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

-- destructive-approved: v0.4.8 app rollback is unsupported after this migration (ADR 0027 expand/contract).
DROP INDEX IF EXISTS "MailTemplate_scope_type_scope_id_key";
