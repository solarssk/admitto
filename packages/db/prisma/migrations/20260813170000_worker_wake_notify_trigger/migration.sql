-- ADR 0042 follow-up: wake the worker immediately when a job is enqueued instead of waiting
-- up to a full poll tick. One shared channel/function for every table that represents async
-- work a user is actively waiting on (AdminJob: export/import; EmailDelivery: mail sends and
-- retries). Periodic/external jobs (bounce ingest, wallet_sync, retention) have no equivalent
-- local insert/update event and stay on the fixed tick.
CREATE FUNCTION admitto_notify_worker_wake() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('admitto_worker_wake', TG_TABLE_NAME);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admitto_admin_job_wake
  AFTER INSERT ON "AdminJob"
  FOR EACH ROW EXECUTE FUNCTION admitto_notify_worker_wake();

-- Retries reuse the existing row (status flips back to 'queued' via UPDATE, not a new INSERT
-- - see packages/mail-delivery/src/claim.ts claimInitialDelivery), so both INSERT and
-- UPDATE OF status need to fire the wake.
CREATE TRIGGER admitto_email_delivery_wake
  AFTER INSERT OR UPDATE OF status ON "EmailDelivery"
  FOR EACH ROW
  WHEN (NEW.status = 'queued')
  EXECUTE FUNCTION admitto_notify_worker_wake();
