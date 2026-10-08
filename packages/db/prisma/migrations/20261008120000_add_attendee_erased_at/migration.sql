-- AlterTable
ALTER TABLE "Attendee" ADD COLUMN "erased_at" TIMESTAMP(3);

-- An erased attendee (erased_at set) must carry no personal data and no ticket credential, whatever
-- code path or raw SQL wrote the row. The placeholder values are the ones packages/tickets/src/
-- erase-attendees.ts writes (ERASED_ATTENDEE_NAME, erasedAttendeeEmail). Status, ticket_type, RSVP
-- and the admission fields are deliberately not constrained: Reports keep reading them.
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_erased_carries_no_personal_data" CHECK (
  "erased_at" IS NULL OR (
    "name" = 'Erased attendee'
    AND "email" = 'erased-' || "id" || '@erased.invalid'
    AND "first_name" IS NULL
    AND "last_name" IS NULL
    AND "company" IS NULL
    AND "department" IS NULL
    AND "custom_data" IS NULL
    AND "token_hash" IS NULL
    AND "token_enc" IS NULL
    AND "qr_payload" IS NULL
    AND "external_uuid" IS NULL
    AND "public_ref" IS NULL
  )
);

-- The namespace of the placeholder addresses is reserved: a live attendee with such an address
-- would collide with the placeholder of the attendee it is named after (unique per event and
-- email) and make that attendee's erasure fail. Import, manual add and edit reject the address
-- with a clear message; this closes every other path.
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_email_not_erased_placeholder" CHECK (
  "erased_at" IS NOT NULL OR lower("email") NOT LIKE '%@erased.invalid'
);

-- The CHECK above only applies while erased_at is set, so clearing erased_at (an explicit
-- UPDATE, or a whole-row upsert) would let personal data back in. Erasure is permanent: once set,
-- erased_at cannot be changed or cleared. Deleting the row (Remove from event) is unaffected.
CREATE FUNCTION admitto_attendee_erased_at_is_permanent() RETURNS trigger AS $$
BEGIN
  IF OLD."erased_at" IS NOT NULL AND NEW."erased_at" IS DISTINCT FROM OLD."erased_at" THEN
    RAISE EXCEPTION 'Attendee.erased_at cannot be changed once set' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Attendee_erased_at_is_permanent"
  BEFORE UPDATE OF "erased_at" ON "Attendee"
  FOR EACH ROW EXECUTE FUNCTION admitto_attendee_erased_at_is_permanent();
