-- DATA-003: DB-level backstops for status enums that drive event-day behavior.
-- Application code validates these values; the CHECK constraints close raw SQL,
-- script, and future migration paths that bypass the TypeScript layer.

ALTER TABLE "Attendee"
  ADD CONSTRAINT "Attendee_status_check"
    CHECK ("status" IN ('registered', 'confirmed', 'cancelled'));

-- Only scanner outcomes that are actually persisted belong in the DB constraint.
-- INVALID / UNKNOWN_EVENT / NETWORK_ERROR are response-only values with no attendee row;
-- PREVIEW writes AttendeeActionLog, not CheckIn.
ALTER TABLE "CheckIn"
  ADD CONSTRAINT "CheckIn_status_check"
    CHECK ("status" IN ('VALID', 'ALREADY_CHECKED_IN', 'REVOKED', 'UNDO'));

ALTER TABLE "AttendeeItemState"
  ADD CONSTRAINT "AttendeeItemState_state_check"
    CHECK ("state" IN ('pending', 'issued', 'returned', 'lost', 'problem', 'not_applicable'));
