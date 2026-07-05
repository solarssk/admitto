-- Add pinned_note to Event
ALTER TABLE "Event" ADD COLUMN "pinned_note" TEXT;

-- Create EventContact
CREATE TABLE "EventContact" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventContact_pkey" PRIMARY KEY ("id")
);

-- Create EventResourceType enum
CREATE TYPE "EventResourceType" AS ENUM ('link', 'file');

-- Create EventResource
CREATE TABLE "EventResource" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "EventResourceType" NOT NULL DEFAULT 'link',
    "url" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventResource_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "EventContact_event_id_sort_order_idx" ON "EventContact"("event_id", "sort_order");
CREATE INDEX "EventResource_event_id_sort_order_idx" ON "EventResource"("event_id", "sort_order");

-- Foreign keys
ALTER TABLE "EventContact" ADD CONSTRAINT "EventContact_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
