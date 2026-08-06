-- Short history of bounce-ingest runs per event (Recent checks UI).
CREATE TABLE "BounceIngestRun" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "summary" JSONB NOT NULL,

    CONSTRAINT "BounceIngestRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BounceIngestRun_event_id_ran_at_idx" ON "BounceIngestRun"("event_id", "ran_at" DESC);

ALTER TABLE "BounceIngestRun" ADD CONSTRAINT "BounceIngestRun_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
