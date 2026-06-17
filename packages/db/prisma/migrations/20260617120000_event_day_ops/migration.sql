-- Event-day operations domain (ADR 0010): EventItem, AttendeeItemState, AttendeeNote, AttendeeActionLog.

-- AlterTable
ALTER TABLE "Attendee" ADD COLUMN "custom_data" JSONB;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "ops_config" JSONB;

-- CreateTable
CREATE TABLE "EventItem" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'item',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendeeItemState" (
    "id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "event_item_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "AttendeeItemState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendeeNote" (
    "id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendeeNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendeeActionLog" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "session_id" TEXT,
    "device_id" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendeeActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventItem_event_id_idx" ON "EventItem"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventItem_event_id_key_key" ON "EventItem"("event_id", "key");

-- CreateIndex
CREATE INDEX "AttendeeItemState_attendee_id_idx" ON "AttendeeItemState"("attendee_id");

-- CreateIndex
CREATE UNIQUE INDEX "AttendeeItemState_attendee_id_event_item_id_key" ON "AttendeeItemState"("attendee_id", "event_item_id");

-- CreateIndex
CREATE INDEX "AttendeeNote_attendee_id_created_at_idx" ON "AttendeeNote"("attendee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AttendeeNote_event_id_idx" ON "AttendeeNote"("event_id");

-- CreateIndex
CREATE INDEX "AttendeeActionLog_event_id_created_at_idx" ON "AttendeeActionLog"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "AttendeeActionLog_attendee_id_created_at_idx" ON "AttendeeActionLog"("attendee_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "EventItem" ADD CONSTRAINT "EventItem_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeItemState" ADD CONSTRAINT "AttendeeItemState_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeItemState" ADD CONSTRAINT "AttendeeItemState_event_item_id_fkey" FOREIGN KEY ("event_item_id") REFERENCES "EventItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeNote" ADD CONSTRAINT "AttendeeNote_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeNote" ADD CONSTRAINT "AttendeeNote_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeActionLog" ADD CONSTRAINT "AttendeeActionLog_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeActionLog" ADD CONSTRAINT "AttendeeActionLog_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default ops_config for existing events
UPDATE "Event"
SET "ops_config" = '{"require_confirm_on_scan":false,"badge_at_entry":true}'::jsonb
WHERE "ops_config" IS NULL;

-- Backfill custom_data from legacy company/department columns
UPDATE "Attendee"
SET "custom_data" = (
  CASE
    WHEN "company" IS NOT NULL AND "department" IS NOT NULL THEN
      jsonb_build_object('company', "company", 'department', "department")
    WHEN "company" IS NOT NULL THEN jsonb_build_object('company', "company")
    WHEN "department" IS NOT NULL THEN jsonb_build_object('department', "department")
    ELSE NULL
  END
)
WHERE "custom_data" IS NULL
  AND ("company" IS NOT NULL OR "department" IS NOT NULL);

-- Seed default EventItem rows for all events (idempotent re-run safe — Lock #7)
INSERT INTO "EventItem" ("id", "event_id", "key", "label", "type", "enabled", "config", "created_at", "updated_at")
SELECT
  'ei_' || substr(md5(e."id" || ':giftbag'), 1, 24),
  e."id",
  'giftbag',
  'Gift bag',
  'item',
  true,
  '{"size_field":"shirt_size"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Event" e
ON CONFLICT ("event_id", "key") DO NOTHING;

INSERT INTO "EventItem" ("id", "event_id", "key", "label", "type", "enabled", "config", "created_at", "updated_at")
SELECT
  'ei_' || substr(md5(e."id" || ':badge'), 1, 24),
  e."id",
  'badge',
  'Badge',
  'item',
  true,
  '{"issue_on_checkin":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Event" e
ON CONFLICT ("event_id", "key") DO NOTHING;

INSERT INTO "EventItem" ("id", "event_id", "key", "label", "type", "enabled", "config", "created_at", "updated_at")
SELECT
  'ei_' || substr(md5(e."id" || ':headset'), 1, 24),
  e."id",
  'headset',
  'Headset',
  'item',
  true,
  '{"requires_return":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Event" e
ON CONFLICT ("event_id", "key") DO NOTHING;
