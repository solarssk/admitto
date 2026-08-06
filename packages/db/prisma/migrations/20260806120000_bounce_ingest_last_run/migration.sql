-- Persist last automatic bounce-ingest run per event (for UI + soft health).
ALTER TABLE "BounceIngestSettings" ADD COLUMN "last_run_at" TIMESTAMP(3),
ADD COLUMN "last_run_ok" BOOLEAN,
ADD COLUMN "last_run_summary" JSONB;
