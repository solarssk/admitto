-- Defense-in-depth: match API/domain MAX_ATTENDEE_NOTE_LENGTH (2000).
ALTER TABLE "AttendeeNote"
  ADD CONSTRAINT "AttendeeNote_body_length" CHECK (char_length("body") <= 2000);
