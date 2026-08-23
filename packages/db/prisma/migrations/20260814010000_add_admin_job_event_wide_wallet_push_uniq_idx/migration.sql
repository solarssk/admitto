-- Enforces at most one pending/running *event_wide* wallet_push job per event - closes a
-- check-then-insert race in enqueueEventWideWalletPushJob (wallet-push-routes.ts) where two
-- concurrent Basic information/Location saves for the same event could otherwise each pass the
-- findFirst dedupe check before either finishes its create(), both enqueueing a duplicate
-- event-wide push (bot review, PR893). Scoped to type=wallet_push AND kind=event_wide AND status
-- IN (pending, running) specifically - an attendee_ids-kind job (bulk ticket-type change) or a
-- succeeded/failed event-wide job must never block a new one.
CREATE UNIQUE INDEX "AdminJob_event_wide_wallet_push_pending_uniq"
  ON "AdminJob" ("event_id")
  WHERE "type" = 'wallet_push'
    AND "status" IN ('pending', 'running')
    AND ("result_json" -> 'request' ->> 'kind') = 'event_wide';
