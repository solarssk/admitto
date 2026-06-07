-- AlterTable: add qr_payload to Attendee
ALTER TABLE "Attendee" ADD COLUMN "qr_payload" TEXT;

-- RedefineTables: extend CheckIn with event_id, status, checked_in_by, source, notes
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendee_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "checked_in_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "checked_in_by" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "device_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckIn_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CheckIn_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CheckIn" ("id", "attendee_id", "event_id", "checked_in_at", "created_at", "device_id")
SELECT ci."id", ci."attendee_id", a."event_id", ci."checked_in_at", ci."created_at", ci."device_id"
FROM "CheckIn" ci
JOIN "Attendee" a ON a."id" = ci."attendee_id";
DROP TABLE "CheckIn";
ALTER TABLE "new_CheckIn" RENAME TO "CheckIn";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex: unique (event_id, external_uuid) for idempotent re-import
CREATE UNIQUE INDEX "Attendee_event_id_external_uuid_key" ON "Attendee"("event_id", "external_uuid");
