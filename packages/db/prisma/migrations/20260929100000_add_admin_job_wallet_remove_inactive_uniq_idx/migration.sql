-- Enforces at most one pending/running wallet_remove_inactive job per event - same reasoning as
-- 20260928110000_add_admin_job_wallet_void_active_uniq_idx (its own comment covers the shared
-- check-then-insert race this closes). Every wallet_remove_inactive job is event-wide by
-- construction, so no result_json condition is needed.
CREATE UNIQUE INDEX "AdminJob_wallet_remove_inactive_pending_uniq"
  ON "AdminJob" ("event_id")
  WHERE "type" = 'wallet_remove_inactive'
    AND "status" IN ('pending', 'running');
