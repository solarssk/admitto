-- Enforces at most one pending/running wallet_void_active job per event - the same
-- check-then-insert race the event-wide wallet_push and wallet_refresh_status enqueue paths are
-- exposed to (see 20260814010000_add_admin_job_event_wide_wallet_push_uniq_idx and
-- 20260831000000_add_admin_job_wallet_refresh_status_uniq_idx), closed here by the database
-- rather than by a read-then-write check alone. Every wallet_void_active job is event-wide by
-- construction, so no result_json condition is needed.
CREATE UNIQUE INDEX "AdminJob_wallet_void_active_pending_uniq"
  ON "AdminJob" ("event_id")
  WHERE "type" = 'wallet_void_active'
    AND "status" IN ('pending', 'running');
