-- Enforces at most one pending/running wallet_refresh_status job per event - same
-- check-then-insert race enqueueEventWideWalletRefreshStatusJob (wallet-refresh-status-routes.ts)
-- would otherwise be exposed to as the wallet_push event-wide dedup index already fixed for that
-- sibling job type (see 20260814010000_add_admin_job_event_wide_wallet_push_uniq_idx). Every
-- wallet_refresh_status job is event-wide by construction (there's no attendee_ids-kind variant -
-- an operator-bounded selection refreshes synchronously instead, see
-- attendees-api-routes.ts's bulk-wallet-refresh-status), so this index doesn't need the
-- wallet_push index's extra result_json->request->>kind condition.
CREATE UNIQUE INDEX "AdminJob_wallet_refresh_status_pending_uniq"
  ON "AdminJob" ("event_id")
  WHERE "type" = 'wallet_refresh_status'
    AND "status" IN ('pending', 'running');
