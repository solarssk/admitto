-- AddForeignKey
-- NOT VALID: this migration runs before the (separate, later) backfill step in
-- deploy/docker-entrypoint.sh, so an existing self-hosted install upgrading from a pre-catalog
-- version can still have attendees with a free-text ticket_type and zero TicketType rows at the
-- moment this migration applies - a fully-validated constraint would make this migration itself
-- fail on that data. NOT VALID enforces the constraint for every write from this point forward
-- (inserts/updates are always checked in real time) without requiring existing rows to already
-- satisfy it; the backfill step that runs right after normalizes them anyway.
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_event_id_ticket_type_fkey" FOREIGN KEY ("event_id", "ticket_type") REFERENCES "TicketType"("event_id", "key") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
