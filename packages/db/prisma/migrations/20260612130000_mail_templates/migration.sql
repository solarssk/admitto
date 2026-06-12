-- Mail templates per scope + branding URL columns on Organization/Event (ADR 0008).

ALTER TABLE "Organization"
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "header_image_url" TEXT;

ALTER TABLE "Event"
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "header_image_url" TEXT;

CREATE TABLE "MailTemplate" (
  "id"                     TEXT NOT NULL,
  "scope_type"             TEXT NOT NULL,
  "scope_id"               TEXT NOT NULL,
  "subject_template"       TEXT NOT NULL,
  "body_template"          TEXT NOT NULL,
  "template_format"        TEXT NOT NULL,
  "compiled_html_template" TEXT NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailTemplate_scope_type_scope_id_key"
  ON "MailTemplate" ("scope_type", "scope_id");

ALTER TABLE "MailTemplate"
  ADD CONSTRAINT "MailTemplate_scope_type_check"
    CHECK (scope_type IN ('organization', 'event'));

ALTER TABLE "MailTemplate"
  ADD CONSTRAINT "MailTemplate_template_format_check"
    CHECK (template_format IN ('mjml', 'html'));
