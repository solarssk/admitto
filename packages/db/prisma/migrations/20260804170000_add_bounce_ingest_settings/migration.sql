-- Event-scoped IMAP bounce ingest settings + processed UID dedup (ADR 0039).
CREATE TABLE "BounceIngestSettings" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "imap_host" TEXT,
    "imap_port" INTEGER,
    "imap_username" TEXT,
    "imap_password_enc" TEXT,
    "reuse_smtp_credentials" BOOLEAN NOT NULL DEFAULT false,
    "folders" JSONB,
    "poll_interval_minutes" INTEGER DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BounceIngestSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BounceIngestSettings_event_id_key" ON "BounceIngestSettings"("event_id");

ALTER TABLE "BounceIngestSettings" ADD CONSTRAINT "BounceIngestSettings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BounceIngestProcessedUid" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BounceIngestProcessedUid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BounceIngestProcessedUid_event_id_folder_uid_key" ON "BounceIngestProcessedUid"("event_id", "folder", "uid");

CREATE INDEX "BounceIngestProcessedUid_event_id_folder_idx" ON "BounceIngestProcessedUid"("event_id", "folder");

ALTER TABLE "BounceIngestProcessedUid" ADD CONSTRAINT "BounceIngestProcessedUid_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
