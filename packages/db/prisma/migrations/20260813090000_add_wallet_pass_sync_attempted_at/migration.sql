-- Separates "last genuinely successful registration check" (registration_checked_at, unchanged)
-- from "last sync attempt, success or failure" (registration_sync_attempted_at, new). The sync
-- worker's anti-starvation backoff now schedules off the new attempted column, so a failed check
-- no longer makes a stale row look like it was recently verified. Nullable/additive - existing
-- rows simply read as "never attempted" until the worker's next tick reaches them.
ALTER TABLE "WalletPass" ADD COLUMN "registration_sync_attempted_at" TIMESTAMP(3);
