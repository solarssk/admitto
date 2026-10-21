-- Legal texts of an event (v0.8, D-F2). Additive only: one new table, no change to an existing one.
-- Nothing in the application reads or shows a text until an event publishes one, and the public form
-- that needs them is off unless an event has a registration mode, so this changes nothing today.

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "content_html" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_event_id_kind_key_key" ON "LegalDocument"("event_id", "kind", "key");

-- AddForeignKey
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- kind is TEXT plus a CHECK, like every closed set (20260626220000_status_check_constraints).
-- Values: packages/db/src/status.ts (LEGAL_DOCUMENT_KIND).
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_kind_check"
  CHECK ("kind" IN ('privacy_notice', 'event_terms', 'consent'));

-- Only a consent has a key. The unique index above can then hold one privacy notice and one set of
-- terms per event (the empty key is a value, not a NULL, which a unique index would not compare).
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_key_iff_consent"
  CHECK (("kind" = 'consent') = ("key" <> ''));

-- The key ends up in a URL (/legal/<event>/consent-<key>) and as a key of Registration.consents.
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_key_format"
  CHECK ("key" = '' OR "key" ~ '^[a-z0-9][a-z0-9_-]{0,39}$');

-- \S is any character that is not whitespace (btrim alone would trim spaces only, not tabs or newlines).
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_title_not_blank"
  CHECK ("title" ~ '\S');

-- A published text is never an empty page.
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_published_not_blank"
  CHECK ("published_at" IS NULL OR "content_html" ~ '\S');
