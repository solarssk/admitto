-- CreateTable
CREATE TABLE "EventImageAsset" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventImageAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventImageAsset_event_id_idx" ON "EventImageAsset"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventImageAsset_event_id_token_key" ON "EventImageAsset"("event_id", "token");

-- AddForeignKey
ALTER TABLE "EventImageAsset" ADD CONSTRAINT "EventImageAsset_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
