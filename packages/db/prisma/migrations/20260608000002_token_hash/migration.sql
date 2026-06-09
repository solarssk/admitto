-- Step 2 (ADR 0001): replace raw token storage with SHA-256 hash.
-- token_hash is nullable to support Mode B (agency) attendees that have no internal token.
-- This migration intentionally discards Step 1 placeholder tokens by setting token_hash = NULL.
-- That is acceptable only for greenfield/dev data where no real tickets have been issued yet.
-- If real issued tickets existed, a dedicated backfill from old raw token -> sha256(token) would be required.
-- SQLite requires full table recreation to drop a column and change constraints.
PRAGMA foreign_keys=OFF;

CREATE TABLE "_new_Attendee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT,
    "qr_payload" TEXT,
    "external_uuid" TEXT,
    "ticket_type" TEXT,
    "company" TEXT,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "_new_Attendee_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "_new_Attendee" (
    "id", "event_id", "email", "name",
    "token_hash", "qr_payload", "external_uuid",
    "ticket_type", "company", "department",
    "status", "created_at"
)
SELECT
    "id", "event_id", "email", "name",
    NULL, "qr_payload", "external_uuid",
    "ticket_type", "company", "department",
    "status", "created_at"
FROM "Attendee";

DROP TABLE "Attendee";
ALTER TABLE "_new_Attendee" RENAME TO "Attendee";

CREATE UNIQUE INDEX "Attendee_token_hash_key" ON "Attendee"("token_hash");
CREATE UNIQUE INDEX "Attendee_email_key" ON "Attendee"("event_id", "email");
CREATE UNIQUE INDEX "Attendee_event_id_external_uuid_key" ON "Attendee"("event_id", "external_uuid");
CREATE UNIQUE INDEX "Attendee_event_id_qr_payload_key" ON "Attendee"("event_id", "qr_payload");
CREATE INDEX "Attendee_external_uuid_idx" ON "Attendee"("external_uuid");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
