-- Speeds up "latest EmailDelivery per attendee" lookups (overview bounce KPI and
-- attendeeMailStatusSql): ORDER BY created_at DESC, id DESC LIMIT 1 WHERE attendee_id = ?
CREATE INDEX "EmailDelivery_attendee_id_created_at_id_idx" ON "EmailDelivery"("attendee_id", "created_at" DESC, "id" DESC);
