-- Backfill public_ref for existing Mode B (agency) attendees.
-- Same entropy as application generateToken: 32 CSPRNG bytes, base64url (~43 chars).
-- Idempotent: only NULL public_ref rows with agency markers are updated.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

UPDATE "Attendee"
SET "public_ref" = rtrim(
  translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_'),
  '='
)
WHERE "public_ref" IS NULL
  AND ("qr_payload" IS NOT NULL OR "external_uuid" IS NOT NULL);
