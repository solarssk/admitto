-- CreateIndex
-- CONCURRENTLY: Notification is written continuously (InAppChannel inserts, retention deletes) -
-- a plain CREATE INDEX takes a lock that blocks those writers for the build's duration if an app
-- or worker stays connected during deploy (bot review finding). Must be the only statement in
-- this file: Prisma only skips wrapping a migration in a transaction when it has exactly one
-- statement, and CONCURRENTLY cannot run inside a transaction.
CREATE INDEX CONCURRENTLY "Notification_user_id_created_at_id_idx" ON "Notification"("user_id", "created_at", "id");
