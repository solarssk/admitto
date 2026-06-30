-- Allow admin pass revoke/restore (v0.4.8); check-in and issue paths already expect 'revoked'.

ALTER TABLE "Attendee" DROP CONSTRAINT IF EXISTS "Attendee_status_check";

ALTER TABLE "Attendee"
  ADD CONSTRAINT "Attendee_status_check"
    CHECK ("status" IN ('registered', 'confirmed', 'cancelled', 'revoked'));
