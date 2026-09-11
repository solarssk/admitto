-- CreateIndex
-- CONCURRENTLY: same reasoning as the (user_id, created_at, id) index migration - Notification is
-- written continuously and a plain CREATE INDEX would block those writers while it builds (bot
-- review finding). Must stay the only statement in this file for Prisma to skip the transaction
-- wrapper CONCURRENTLY cannot run inside.
CREATE INDEX CONCURRENTLY "Notification_created_at_idx" ON "Notification"("created_at");
