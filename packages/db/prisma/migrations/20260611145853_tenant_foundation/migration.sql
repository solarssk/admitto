-- Additive migration: multi-tenant foundation (ADR 0005) + encryption columns (ADR 0006).
-- No schema reset. Safe on greenfield (no production data).

-- 1. CreateTable Organization
-- Must come before FK references on Event and EmailDelivery.
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- 2. Insert default organization with stable ID.
-- Used as FK target for backfill in steps 3–6.
-- Stable ID 'org_default' is intentional: only the seeded default org uses a fixed ID.
-- All future organizations created via UI/API use cuid() as standard.
INSERT INTO "Organization" ("id", "name", "slug", "created_at")
VALUES ('org_default', 'Default', 'default', NOW())
ON CONFLICT ("slug") DO NOTHING;

-- 3. Add organization_id to Event (nullable first for backfill).
ALTER TABLE "Event" ADD COLUMN "organization_id" TEXT;

-- 4. Backfill all existing events to the default org.
UPDATE "Event" SET "organization_id" = 'org_default';

-- 5. Apply NOT NULL constraint and FK on Event.organization_id.
ALTER TABLE "Event" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "Event" ADD CONSTRAINT "Event_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Event_organization_id_idx" ON "Event"("organization_id");

-- 6. Add organization_id to EmailDelivery (nullable first for backfill).
ALTER TABLE "EmailDelivery" ADD COLUMN "organization_id" TEXT;

-- 7. Backfill EmailDelivery rows (no-op if table is empty on greenfield).
UPDATE "EmailDelivery" SET "organization_id" = 'org_default';

-- 8. Apply NOT NULL constraint and FK on EmailDelivery.organization_id.
ALTER TABLE "EmailDelivery" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "Organization"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "EmailDelivery_organization_id_idx" ON "EmailDelivery"("organization_id");

-- 9. Add token_enc to Attendee (nullable; null for Mode B and unissued Mode A attendees).
ALTER TABLE "Attendee" ADD COLUMN "token_enc" TEXT;

-- 10. CreateTable RoleAssignment.
CREATE TABLE "RoleAssignment" (
    "id" TEXT NOT NULL,
    "user_ref" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RoleAssignment_user_ref_idx" ON "RoleAssignment"("user_ref");
CREATE INDEX "RoleAssignment_scope_type_scope_id_idx" ON "RoleAssignment"("scope_type", "scope_id");
