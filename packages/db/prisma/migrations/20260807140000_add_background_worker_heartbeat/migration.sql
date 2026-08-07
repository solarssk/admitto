-- ADR 0042: worker process heartbeat for Health + Docker HEALTHCHECK.
CREATE TABLE "BackgroundWorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "last_beat_at" TIMESTAMP(3) NOT NULL,
    "hostname" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundWorkerHeartbeat_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BackgroundWorkerHeartbeat_singleton" CHECK ("id" = 'default')
);
