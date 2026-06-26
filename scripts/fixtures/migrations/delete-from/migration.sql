-- Destructive DML should be flagged unless explicitly approved.
DELETE FROM "EmailDelivery" WHERE "created_at" < now() - interval '30 days';
