-- CreateTable
CREATE TABLE "EventCustomField" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "source_field" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCustomField_event_id_idx" ON "EventCustomField"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventCustomField_event_id_source_field_key" ON "EventCustomField"("event_id", "source_field");

-- AddForeignKey
ALTER TABLE "EventCustomField" ADD CONSTRAINT "EventCustomField_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
