-- DATA-002: DB-level backstop for the RSVP status enum.
-- Application routes validate this with Zod; the CHECK closes raw SQL,
-- script, and future migration paths that bypass the API layer.
ALTER TABLE "Attendee"
  ADD CONSTRAINT "Attendee_rsvp_status_check"
    CHECK ("rsvp_status" IN ('none', 'confirmed', 'declined', 'tentative', 'cancelled'));
