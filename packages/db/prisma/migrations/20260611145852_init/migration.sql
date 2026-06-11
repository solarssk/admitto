-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendee" (
    "id" TEXT NOT NULL,
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
    "admitted_at" TIMESTAMP(3),
    "admitted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletPass" (
    "id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "pass_type_id" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "pass_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "attendee_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "checked_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "checked_in_by" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "device_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_token_hash_key" ON "Attendee"("token_hash");

-- CreateIndex
CREATE INDEX "Attendee_external_uuid_idx" ON "Attendee"("external_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_event_id_email_key" ON "Attendee"("event_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_event_id_external_uuid_key" ON "Attendee"("event_id", "external_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_event_id_qr_payload_key" ON "Attendee"("event_id", "qr_payload");

-- CreateIndex
CREATE UNIQUE INDEX "WalletPass_attendee_id_key" ON "WalletPass"("attendee_id");

-- AddForeignKey
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletPass" ADD CONSTRAINT "WalletPass_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_attendee_id_fkey" FOREIGN KEY ("attendee_id") REFERENCES "Attendee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
