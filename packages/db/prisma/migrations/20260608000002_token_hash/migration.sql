-- Step 2 (ADR 0001): replace raw token storage with SHA-256 hash.
-- token_hash is nullable to support Mode B (agency) attendees that have no internal token.
-- This migration intentionally discards Step 1 placeholder tokens by setting token_hash = NULL.
-- That is acceptable only for greenfield/dev data where no real tickets have been issued yet.
-- If real issued tickets existed, a dedicated backfill from old raw token -> sha256(token) would be required.
-- This migration also introduces event-scoped uniqueness for non-null qr_payload.
-- Fail early with a readable error before table recreation if legacy data already violates that invariant.
-- SQLite requires full table recreation to drop a column and change constraints.
PRAGMA foreign_keys=OFF;

CREATE TEMP TABLE "_migration_guard" (
    "ok" INTEGER NOT NULL CHECK ("ok" = 1)
);

CREATE TEMP TRIGGER "_abort_duplicate_qr_payloads"
BEFORE INSERT ON "_migration_guard"
WHEN NEW."ok" = 0
BEGIN
    SELECT RAISE(ABORT, 'Migration blocked: duplicate non-null qr_payload values exist within the same event. Deduplicate legacy attendee data before applying 20260608000002_token_hash.');
END;

INSERT INTO "_migration_guard" ("ok")
SELECT CASE
    WHEN EXISTS (
        SELECT 1
        FROM "Attendee"
        WHERE "qr_payload" IS NOT NULL
        GROUP BY "event_id", "qr_payload"
        HAVING COUNT(*) > 1
    ) THEN 0
    ELSE 1
END;

DROP TRIGGER "_abort_duplicate_qr_payloads";
DROP TABLE "_migration_guard";

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
