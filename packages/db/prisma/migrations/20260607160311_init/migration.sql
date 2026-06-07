-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "location" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Attendee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "external_uuid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'registered',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attendee_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletPass" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendee_id" TEXT NOT NULL,
    "pass_type_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "pass_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "WalletPass_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendee_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailDelivery_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendee_id" TEXT NOT NULL,
    "checked_in_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckIn_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_token_key" ON "Attendee"("token");

-- CreateIndex
CREATE INDEX "Attendee_external_uuid_idx" ON "Attendee"("external_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_event_id_email_key" ON "Attendee"("event_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "WalletPass_attendee_id_key" ON "WalletPass"("attendee_id");
