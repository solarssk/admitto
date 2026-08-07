-- ADR 0042: AdminJob queue for async import (and later export).
CREATE TABLE "AdminJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "organization_id" TEXT NOT NULL,
    "event_id" TEXT,
    "actor_user_id" TEXT,
    "session_id" TEXT,
    "client_timezone" TEXT,
    "storage_key" TEXT,
    "filename" TEXT,
    "overwrite" BOOLEAN NOT NULL DEFAULT false,
    "force_capacity" BOOLEAN NOT NULL DEFAULT false,
    "import_id" TEXT,
    "to_create" INTEGER,
    "to_update" INTEGER,
    "to_skip" INTEGER,
    "created_count" INTEGER,
    "updated_count" INTEGER,
    "skipped_count" INTEGER,
    "invalid_count" INTEGER,
    "error" TEXT,
    "result_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminJob_status_type_created_at_idx" ON "AdminJob"("status", "type", "created_at");
CREATE INDEX "AdminJob_event_id_created_at_idx" ON "AdminJob"("event_id", "created_at" DESC);
CREATE INDEX "AdminJob_organization_id_created_at_idx" ON "AdminJob"("organization_id", "created_at" DESC);

ALTER TABLE "AdminJob" ADD CONSTRAINT "AdminJob_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminJob" ADD CONSTRAINT "AdminJob_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
